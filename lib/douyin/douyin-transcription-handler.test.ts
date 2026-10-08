import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundContext } from '@/lib/background/types';
import type { TranscribeErrorInfo, TranscribeRequest, TranscribeResponse } from '@/lib/transcription/types';
import { buildDetailRequest, type DouyinRequest, type DouyinTransportResult } from './douyin-api';
import { pickAudioSourceUrls } from './douyin-media';

// Boundary of the Service Worker handler: the tab leaf (chrome.*), the ASR
// settings item, the subtitle cache (an eager `defineItem`), the ASR client,
// the shared downloader and the fingerprint guard. Everything between —
// pipeline, `createTranscribeAudio`, `requestEnvelope`, `classifyResponse`,
// `decodeDetail`, `pickAudioSourceUrls` — is real.
const boundary = vi.hoisted(() => ({
  findDouyinTab: vi.fn(),
  douyinTabTransport: vi.fn(),
  getAsrSettings: vi.fn(),
  getVideoCache: vi.fn(),
  mergeVideoCache: vi.fn(),
  ensureGroqConnectivity: vi.fn(),
  requestGroqTranscription: vi.fn(),
  fetchFirstAudioBlob: vi.fn(),
  assertAudioNotReused: vi.fn(),
}));

vi.mock('./douyin-tab', () => ({
  findDouyinTab: boundary.findDouyinTab,
  douyinTabTransport: boundary.douyinTabTransport,
}));
vi.mock('@/lib/storage/settings', () => ({ getAsrSettings: boundary.getAsrSettings }));
vi.mock('@/lib/cache/video-cache', () => ({
  getVideoCache: boundary.getVideoCache,
  mergeVideoCache: boundary.mergeVideoCache,
}));
vi.mock('@/lib/transcription/groq-client', () => ({
  ensureGroqConnectivity: boundary.ensureGroqConnectivity,
  requestGroqTranscription: boundary.requestGroqTranscription,
}));
vi.mock('@/lib/transcription/audio-extractor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/transcription/audio-extractor')>()),
  fetchFirstAudioBlob: boundary.fetchFirstAudioBlob,
}));
vi.mock('@/lib/transcription/audio-fingerprint', () => ({
  assertAudioNotReused: boundary.assertAudioNotReused,
}));

import {
  createDouyinTranscribeHandler,
  handleDouyinTranscribe,
  type DouyinTranscribeSession,
} from './douyin-transcription-handler';

// ---------------------------------------------------------------------------
// Fixtures — the detail media shape of the 2026-10-08 probe (see
// douyin-media.test.ts for the full set); ids and signed URLs redacted.
// ---------------------------------------------------------------------------

const ID = '7300000000000000123';
const TAB_ID = 7;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
/** `VITE_DOUYIN_COOLDOWN_MS` default, in seconds — what `retryAfter` must say with a fixed clock. */
const COOLDOWN_SECONDS = 1_800;
const ROWS = [
  { start: 0, end: 1.2, text: '大家好' },
  { start: 1.2, end: 3, text: '今天讲三件事' },
];

function audioTrack(prefix: string) {
  return {
    audio_meta: {
      bitrate: 48_570,
      format: 'dash',
      media_type: 'audio',
      url_list: {
        main_url: `https://v26-web.douyinvod.com/sig26/exp/video/tos/cn/audio-${prefix}/`,
        backup_url: `https://v11-weba.douyinvod.com/sig11/exp/video/tos/cn/audio-${prefix}/`,
        fallback_url: `https://www.douyin.com/aweme/v1/play/?file_id=audio-${prefix}&sign=s`,
      },
    },
    audio_quality: 5,
  };
}

function urls(gear: string): string[] {
  return [
    `https://v11-weba.douyinvod.com/sig11/exp/video/tos/cn/${gear}/`,
    `https://v26-web.douyinvod.com/sig26/exp/video/tos/cn/${gear}/`,
    `https://www.douyin.com/aweme/v1/play/?file_id=${gear}&sign=s&biz_sign=b`,
  ];
}

function gear(name: string, bitRate: number, format: 'mp4' | 'dash', isH265: 0 | 1) {
  return { bit_rate: bitRate, format, gear_name: name, is_h265: isH265, play_addr: { uri: name, url_list: urls(name) } };
}

function detailPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aweme_id: ID,
    desc: 'a video',
    video: {
      duration: 99_000,
      bit_rate_audio: [audioTrack('a')],
      bit_rate: [gear('720_3_1', 480_000, 'dash', 1), gear('adapt_low_540_0', 620_000, 'mp4', 0)],
      play_addr: { uri: 'main', url_list: urls('play_addr') },
    },
    ...overrides,
  };
}

function detailBody(json: Record<string, unknown>): Record<string, unknown> {
  return { status_code: 0, log_pb: { impr_id: 'x' }, ...json };
}

function ok(body: unknown, status = 200): DouyinTransportResult {
  return { kind: 'response', status, text: JSON.stringify(body) };
}

function raw(text: string, status = 200): DouyinTransportResult {
  return { kind: 'response', status, text };
}

/** Transport that answers each call from a script; records every request. */
function scripted(...results: DouyinTransportResult[]) {
  const requests: DouyinRequest[] = [];
  const transport = vi.fn(async (req: DouyinRequest) => {
    requests.push(req);
    const next = results.shift();
    if (!next) throw new Error('script exhausted');
    return next;
  });
  return { transport, requests };
}

function session(
  transport: DouyinTranscribeSession['transport'],
  extra: Partial<DouyinTranscribeSession> = {},
): DouyinTranscribeSession {
  return {
    findTab: vi.fn(async () => TAB_ID),
    transport,
    pacer: { beforeRequest: vi.fn(async () => {}) },
    now: () => NOW,
    ...extra,
  };
}

function request(): TranscribeRequest {
  return { type: 'TRANSCRIBE_AUDIO', platform: 'douyin', videoId: ID, title: 'a video' };
}

function context(): BackgroundContext {
  return {
    sendToTab: vi.fn(),
    ensureOffscreen: vi.fn(async () => {}),
    registerChunkSession: vi.fn(),
    unregisterChunkSession: vi.fn(),
  } as unknown as BackgroundContext;
}

/** A failed result must also have been pushed to the tab as `stage: 'failed'` with the same code. */
function expectFailure(result: TranscribeResponse, ctx: BackgroundContext, code: TranscribeErrorInfo['code']): TranscribeErrorInfo {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  expect(result.error.code).toBe(code);
  expect(ctx.sendToTab).toHaveBeenCalledWith(
    TAB_ID,
    expect.objectContaining({ type: 'TRANSCRIBE_STATUS', videoId: ID, stage: 'failed', error: expect.objectContaining({ code }) }),
  );
  return result.error;
}

function run(s: DouyinTranscribeSession, ctx = context(), signal = new AbortController().signal) {
  return createDouyinTranscribeHandler(s)(request(), TAB_ID, ctx, signal);
}

beforeEach(() => {
  boundary.findDouyinTab.mockReset().mockResolvedValue(null);
  boundary.douyinTabTransport.mockReset();
  boundary.getAsrSettings.mockReset().mockResolvedValue({ apiKey: 'key', model: 'whisper', baseUrl: 'https://asr.test' });
  boundary.getVideoCache.mockReset().mockResolvedValue(null);
  boundary.mergeVideoCache.mockReset().mockResolvedValue(undefined);
  boundary.ensureGroqConnectivity.mockReset().mockResolvedValue(undefined);
  boundary.requestGroqTranscription.mockReset().mockResolvedValue({ rows: ROWS, quota: {} });
  boundary.fetchFirstAudioBlob.mockReset().mockImplementation(async (candidates: string[]) => ({
    url: candidates[0],
    blob: { size: 604_218 } as Blob,
  }));
  boundary.assertAudioNotReused.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pipeline order (docs/37 Step 2 ruling 1): cache → ASR key → only then the tab
// ---------------------------------------------------------------------------

describe('handleDouyinTranscribe — detail is fetched lazily, on the ASR path only', () => {
  it('a cache hit answers without touching the tab, the transport or the ASR settings', async () => {
    boundary.getVideoCache.mockResolvedValue({ platform: 'douyin', videoId: ID, rows: ROWS, source: 'asr', rawHash: 'h', updatedAt: 1 });
    const s = session(vi.fn());

    const result = await run(s);

    expect(result).toEqual({ success: true, data: { videoId: ID, rows: ROWS, source: 'asr', cached: true } });
    expect(boundary.getVideoCache).toHaveBeenCalledWith('douyin', ID);
    expect(s.findTab).not.toHaveBeenCalled();
    expect(s.transport).not.toHaveBeenCalled();
    expect(boundary.getAsrSettings).not.toHaveBeenCalled();
  });

  it('a missing ASR key fails before any signed request is spent', async () => {
    boundary.getAsrSettings.mockResolvedValue({ apiKey: '', model: 'whisper', baseUrl: '' });
    const s = session(vi.fn());
    const ctx = context();

    expectFailure(await run(s, ctx), ctx, 'ASR_INVALID_KEY');
    expect(s.findTab).not.toHaveBeenCalled();
    expect(s.transport).not.toHaveBeenCalled();
    expect(s.pacer.beforeRequest).not.toHaveBeenCalled();
  });

  it('ASR path: one paced detail request, the D-g candidates to the downloader, rows cached as asr', async () => {
    const payload = detailPayload();
    const { transport, requests } = scripted(ok(detailBody({ aweme_detail: payload })));
    const s = session(transport);

    const result = await run(s);

    expect(result).toEqual({ success: true, data: { videoId: ID, rows: ROWS, source: 'asr', cached: false } });
    expect(requests).toEqual([buildDetailRequest(ID)]);
    expect(s.pacer.beforeRequest).toHaveBeenCalledTimes(1);
    expect(s.findTab).toHaveBeenCalledTimes(1);
    expect((s.findTab as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      transport.mock.invocationCallOrder[0]!,
    );
    expect(boundary.fetchFirstAudioBlob).toHaveBeenCalledTimes(1);
    const candidates = boundary.fetchFirstAudioBlob.mock.calls[0]![0] as string[];
    expect(candidates).toEqual(pickAudioSourceUrls(payload));
    expect(candidates.slice(0, 3)).toEqual([
      'https://v26-web.douyinvod.com/sig26/exp/video/tos/cn/audio-a/',
      'https://v11-weba.douyinvod.com/sig11/exp/video/tos/cn/audio-a/',
      'https://www.douyin.com/aweme/v1/play/?file_id=audio-a&sign=s',
    ]);
    expect(boundary.mergeVideoCache).toHaveBeenCalledWith('douyin', ID, ROWS, 'asr');
    expect(boundary.requestGroqTranscription).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Failure shapes → codes (docs/37 §4.3; info.md Step 2 §1.2 fold table)
// ---------------------------------------------------------------------------

describe('handleDouyinTranscribe — failure shapes', () => {
  it('T1: no usable douyin.com tab is DOUYIN_TAB_MISSING (closed) with no request and no pacing', async () => {
    const s = session(vi.fn(), { findTab: vi.fn(async () => null) });
    const ctx = context();

    const error = expectFailure(await run(s, ctx), ctx, 'DOUYIN_TAB_MISSING');

    expect(error.params).toEqual({ reason: 'closed' });
    expect(s.transport).not.toHaveBeenCalled();
    expect(s.pacer.beforeRequest).not.toHaveBeenCalled();
    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('T2: a tab that goes away mid-session spends the shared transient budget, then DOUYIN_TAB_MISSING (closed)', async () => {
    vi.useFakeTimers();
    const gone: DouyinTransportResult = { kind: 'unreachable', message: 'no usable www.douyin.com tab' };
    const { transport } = scripted(gone, gone, gone);
    const s = session(transport);
    const ctx = context();

    const pending = run(s, ctx);
    await vi.runAllTimersAsync();
    const error = expectFailure(await pending, ctx, 'DOUYIN_TAB_MISSING');

    expect(error.params).toEqual({ reason: 'closed' });
    expect(error.message).toMatch(/no usable www.douyin.com tab/);
    expect(transport).toHaveBeenCalledTimes(3);
    // Every attempt is paced (risk control counts requests, retries included)…
    expect(s.pacer.beforeRequest).toHaveBeenCalledTimes(3);
    // …while the T1 gate sits outside the retry loop: one tab lookup per transcription.
    expect(s.findTab).toHaveBeenCalledTimes(1);
  });

  it("T2′: sdk-not-ready is DOUYIN_SIGNATURE_REJECTED (sdk-not-ready), never retried", async () => {
    const { transport } = scripted({ kind: 'sdk-not-ready' });
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_SIGNATURE_REJECTED');

    expect(error.params).toEqual({ reason: 'sdk-not-ready' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('T3: 403 + ArgusSecurityPlugin is DOUYIN_SIGNATURE_REJECTED (argus), never retried', async () => {
    const { transport } = scripted(raw('Blocked by ArgusSecurityPlugin Sign Invalid', 403));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_SIGNATURE_REJECTED');

    expect(error.params).toEqual({ reason: 'argus' });
    expect(error.message).toMatch(/Sign Invalid/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('T4: 403 without an Argus body is DOUYIN_RATE_LIMITED with retryAfter in seconds, and nothing else', async () => {
    const { transport } = scripted(raw('', 403));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_RATE_LIMITED');

    expect(error.retryAfter).toBe(COOLDOWN_SECONDS);
    expect(error.resetAt).toBeUndefined();
    expect(error.providerId).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("T4′: a challenge page (non-JSON 200) is DOUYIN_TAB_MISSING (verify) — the user clears it in the tab", async () => {
    const { transport } = scripted(raw('<!DOCTYPE html><html><title>验证码中间页</title></html>'));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_TAB_MISSING');

    expect(error.params).toEqual({ reason: 'verify' });
  });

  it('T5: status_code 8 + 用户未登录 is DOUYIN_TAB_MISSING (login)', async () => {
    const { transport } = scripted(ok({ status_code: 8, status_msg: '用户未登录' }));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_TAB_MISSING');

    expect(error.params).toEqual({ reason: 'login' });
  });

  it('T6: aweme_detail null with a filter_detail is DOUYIN_MEDIA_UNAVAILABLE carrying the reason', async () => {
    const { transport } = scripted(ok(detailBody({ aweme_detail: null, filter_detail: { status_self_see: 1 } })));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_MEDIA_UNAVAILABLE');

    expect(String(error.params?.reason)).toContain('status_self_see');
    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('an empty payload without filter_detail is the withheld shape: DOUYIN_RATE_LIMITED with the cooldown', async () => {
    const { transport } = scripted(ok(detailBody({ aweme_detail: null })));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'DOUYIN_RATE_LIMITED');

    expect(error.retryAfter).toBe(COOLDOWN_SECONDS);
  });

  it('T7: an aweme with nothing playable is ASR_NO_AUDIO_SOURCE before any download', async () => {
    const { transport } = scripted(ok(detailBody({ aweme_detail: { aweme_id: ID, desc: 'an image post', images: [{}] } })));
    const ctx = context();

    expectFailure(await run(session(transport), ctx), ctx, 'ASR_NO_AUDIO_SOURCE');

    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('T11: another non-zero status_code is ASR_UNKNOWN with the code in params.detail', async () => {
    const { transport } = scripted(ok({ status_code: 5, status_msg: 'invalid parameters' }));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'ASR_UNKNOWN');

    expect(String(error.params?.detail)).toContain('status_code 5');
    expect(String(error.params?.detail)).toContain('invalid parameters');
  });

  it('a detail answered for another aweme_id is refused (ASR_UNKNOWN naming both ids), nothing downloaded', async () => {
    const other = '7300000000000000999';
    const { transport } = scripted(ok(detailBody({ aweme_detail: detailPayload({ aweme_id: other }) })));
    const ctx = context();

    const error = expectFailure(await run(session(transport), ctx), ctx, 'ASR_UNKNOWN');

    expect(String(error.params?.detail)).toContain(other);
    expect(String(error.params?.detail)).toContain(ID);
    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('an abort while the detail request is in flight ends as ASR_REQUEST_TIMEOUT, nothing downloaded', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async () => {
      controller.abort();
      return ok(detailBody({ aweme_detail: detailPayload() }));
    });
    const ctx = context();

    expectFailure(await run(session(transport), ctx, controller.signal), ctx, 'ASR_REQUEST_TIMEOUT');

    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
    expect(boundary.mergeVideoCache).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The default export is wired to the real tab leaf (and its module pacer)
// ---------------------------------------------------------------------------

describe('handleDouyinTranscribe (default session)', () => {
  it('resolves the tab through findDouyinTab and sends through douyinTabTransport', async () => {
    const ctx = context();

    const error = expectFailure(
      await handleDouyinTranscribe(request(), TAB_ID, ctx, new AbortController().signal),
      ctx,
      'DOUYIN_TAB_MISSING',
    );

    expect(error.params).toEqual({ reason: 'closed' });
    expect(boundary.findDouyinTab).toHaveBeenCalledTimes(1);
    expect(boundary.douyinTabTransport).not.toHaveBeenCalled();
  });
});
