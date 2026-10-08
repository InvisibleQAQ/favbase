import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformAuthError, PlatformRateLimitError } from '@/lib/collections/sync-errors';
import { resolveHttpDeadlineMs } from '@/lib/http/fetch-with-deadline';
import { RetrySignal } from '@/lib/http/retry';
import {
  buildCollectionRequest,
  buildDetailRequest,
  buildFolderItemsRequest,
  buildFoldersRequest,
  classifyResponse,
  createDouyinDetailPacer,
  createDouyinPacer,
  DouyinAuthError,
  DouyinRateLimitError,
  DouyinSignatureError,
  DouyinStatusError,
  DouyinUnreachableError,
  fetchPublicFolders,
  findVerifyMarker,
  mapAweme,
  mapFolder,
  requestEnvelope,
  walkCollection,
  walkFolderItems,
  type DouyinAwemePage,
  type DouyinPacer,
  type DouyinRequest,
  type DouyinSession,
  type DouyinTransport,
  type DouyinTransportResult,
} from './douyin-api';

// ---------------------------------------------------------------------------
// Fixtures — shapes replayed from the 2026-10-03 live probe and the dtk replay
// envelope (.trellis/tasks/10-03-douyin-public-favorites-platform/research/).
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const COOLDOWN_MS = 1_800_000;

/** An aweme as `aweme_list` carries it (probe #7 keys; ids are strings). */
function rawAweme(id: string, overrides: Record<string, unknown> = {}) {
  return {
    aweme_id: id,
    aweme_type: 0,
    media_type: 4,
    desc: `desc of ${id} #topic`,
    caption: '',
    item_title: '',
    create_time: 1_758_000_000,
    author: {
      uid: '58200000001',
      sec_uid: 'MS4wLjABAAAA_alice',
      nickname: 'Alice',
      unique_id: 'alice',
      avatar_thumb: { uri: 'x', url_list: ['https://p3-pc.douyinpic.com/avatar.jpeg'] },
    },
    video: {
      duration: 15_300,
      cover: { uri: 'c', url_list: ['https://p3-pc.douyinpic.com/cover.jpeg'] },
    },
    images: null,
    text_extra: [],
    status: { is_delete: false, private_status: 0 },
    statistics: { play_count: 0, collect_count: 12 },
    collect_stat: 1,
    is_collects_selected: 0,
    ...overrides,
  };
}

/** listcollection envelope (probe #4–#6). `cursor` is a 16-digit µs timestamp number. */
function collectionBody(
  awemes: unknown[] | null,
  cursor: number,
  hasMore: 0 | 1,
  extra: Record<string, unknown> = {},
) {
  return {
    aweme_list: awemes,
    cursor,
    extra: { now: NOW, fatal_item_ids: [] },
    has_more: hasMore,
    invalid_item_count: 0,
    invalid_item_text: '',
    is_clear_invalid_item: false,
    log_pb: { impr_id: '20261003120000' },
    sec_uid: 'MS4wLjABAAAA_self',
    status_code: 0,
    uid: '58200000099',
    ...extra,
  };
}

/** collects/list envelope (probe #3 when empty; dtk replay when not). */
function foldersBody(list: unknown[] | null, cursor: number, hasMore: boolean) {
  return {
    collects_list: list,
    cursor,
    extra: { now: NOW },
    has_more: hasMore,
    log_pb: { impr_id: 'x' },
    status_code: 0,
    total_number: list?.length ?? 0,
  };
}

/** One `collects_list` entry (dtk replay: `collects_id` int64 number + `collects_id_str`). */
function rawFolder(idStr: string, name: string, status: unknown) {
  return {
    collects_id: 6910000000000000000,
    collects_id_str: idStr,
    collects_name: name,
    collects_cover: { uri: 'c', url_list: ['https://p3-pc/obj/cover'] },
    total_number: 1,
    status,
    states: 1,
    user_id: 6910000000000000000,
    user_id_str: '6910000000000000900',
    user_info: { nickname: 'self', uid: '6910000000000000900' },
  };
}

function ok(body: unknown, status = 200): DouyinTransportResult {
  return { kind: 'response', status, text: JSON.stringify(body) };
}

function raw(text: string, status = 200): DouyinTransportResult {
  return { kind: 'response', status, text };
}

const noPacer: DouyinPacer = { beforeRequest: async () => {} };

function session(transport: DouyinTransport, extra: Partial<DouyinSession> = {}): DouyinSession {
  return { transport, pacer: noPacer, now: () => NOW, ...extra };
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

/** Classify a transport result with a fixed clock; returns the thrown error. */
function classifyError(result: DouyinTransportResult): unknown {
  try {
    classifyResponse(result, 'Douyin test', () => NOW);
  } catch (err) {
    return err;
  }
  throw new Error('expected classifyResponse to throw');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Requests — business params + three common params, never a signature param
// ---------------------------------------------------------------------------

/** Every parameter the page SDK adds; one pre-filled value voids the signature (docs/33 iron rule 2). */
const SIGNATURE_PARAMS = [
  'a_bogus',
  'X-Bogus',
  'verifyFp',
  'fp',
  'uifid',
  'timestamp',
  'x-secsdk-web-signature',
  'msToken',
];

function allKeys(req: DouyinRequest): string[] {
  return [...Object.keys(req.query), ...Object.keys(req.form ?? {})];
}

describe('douyin request construction', () => {
  const requests: Array<[string, DouyinRequest]> = [
    ['listcollection', buildCollectionRequest('0')],
    ['collects/list', buildFoldersRequest('0')],
    ['collects/video/list', buildFolderItemsRequest('7300000000000000123', '0')],
    ['aweme/detail', buildDetailRequest('7300000000000000123')],
  ];

  it.each(requests)('%s carries zero signature parameters', (_name, req) => {
    for (const key of SIGNATURE_PARAMS) expect(allKeys(req)).not.toContain(key);
  });

  it.each(requests)('%s carries the three common parameters and a relative path', (_name, req) => {
    expect(req.query).toMatchObject({
      device_platform: 'webapp',
      aid: '6383',
      channel: 'channel_pc_web',
    });
    expect(req.path.startsWith('/aweme/v1/web/')).toBe(true);
    expect(req.path).not.toMatch(/^https?:/);
    expect(req.path.endsWith('/')).toBe(true);
    expect(req.timeoutMs).toBe(resolveHttpDeadlineMs());
  });

  it('listcollection is a form-encoded POST: count + cursor in the form, strategy in the query', () => {
    const req = buildCollectionRequest('1789911201230543');
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/aweme/v1/web/aweme/listcollection/');
    expect(req.form).toEqual({ count: '20', cursor: '1789911201230543' });
    expect(req.query.publish_video_strategy_type).toBe('2');
    expect(req.query).not.toHaveProperty('cursor');
    expect(req.query).not.toHaveProperty('count');
  });

  it('collects/list is a GET with an offset cursor and no form', () => {
    const req = buildFoldersRequest('10');
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/aweme/v1/web/collects/list/');
    expect(req.query).toMatchObject({ cursor: '10', count: '20' });
    expect(req.form).toBeUndefined();
  });

  it('collects/video/list spells the folder id collects_id and passes it as the string id', () => {
    const req = buildFolderItemsRequest('7300000000000000123', '20');
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/aweme/v1/web/collects/video/list/');
    expect(req.query.collects_id).toBe('7300000000000000123');
    expect(typeof req.query.collects_id).toBe('string');
    expect(req.query).toMatchObject({ cursor: '20', count: '20' });
    expect(req.form).toBeUndefined();
  });

  it('aweme/detail is a GET keyed by the string aweme_id and no form (docs/37 §4.2)', () => {
    const req = buildDetailRequest('7300000000000000123');
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/aweme/v1/web/aweme/detail/');
    expect(req.query.aweme_id).toBe('7300000000000000123');
    expect(typeof req.query.aweme_id).toBe('string');
    expect(req.form).toBeUndefined();
  });

  it('every query and form value is a string (the transport serialises them verbatim)', () => {
    for (const [, req] of requests) {
      for (const value of [...Object.values(req.query), ...Object.values(req.form ?? {})]) {
        expect(typeof value).toBe('string');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// classifyResponse — docs/33 §4.4, by shape (F1 is app-side)
// ---------------------------------------------------------------------------

describe('classifyResponse', () => {
  it('passes a status_code 0 envelope through with its raw text', () => {
    const result = ok(collectionBody([rawAweme('1')], 1789911201230543, 1));
    const env = classifyResponse(result, 'Douyin test', () => NOW);
    expect(env).not.toBeInstanceOf(RetrySignal);
    expect(env).toMatchObject({ status: 200, json: { status_code: 0 } });
  });

  it('F2: sdk-not-ready is a plain Error (refresh the tab), never retried', () => {
    const err = classifyError({ kind: 'sdk-not-ready' });
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlatformRateLimitError);
    expect(err).not.toBeInstanceOf(PlatformAuthError);
    expect((err as Error).message).toMatch(/SDK/);
  });

  // The transcription handler folds F2 and F3 into one error code and F11 into
  // another (docs/37 §4.3 T2 / T2′ / T3), and must do so by class, never by
  // matching the message text. Both classes are plain `Error` subclasses: the
  // sync side still classifies by the two platform bases and sees no change.
  it('F2 is a DouyinSignatureError whose reason says the SDK was not ready', () => {
    const err = classifyError({ kind: 'sdk-not-ready' });
    expect(err).toBeInstanceOf(DouyinSignatureError);
    expect((err as DouyinSignatureError).reason).toBe('sdk-not-ready');
    expect((err as Error).name).toBe('DouyinSignatureError');
  });

  it('F3: 403 + ArgusSecurityPlugin is a plain Error with the body snippet (a signature problem)', () => {
    const err = classifyError(raw('Blocked by ArgusSecurityPlugin Signature Not Found', 403));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlatformRateLimitError);
    expect((err as Error).message).toMatch(/HTTP 403/);
    expect((err as Error).message).toMatch(/ArgusSecurityPlugin Signature Not Found/);
  });

  it('F3 is a DouyinSignatureError whose reason says Argus refused the signature', () => {
    const err = classifyError(raw('Blocked by ArgusSecurityPlugin Signature Not Found', 403));
    expect(err).toBeInstanceOf(DouyinSignatureError);
    expect((err as DouyinSignatureError).reason).toBe('argus');
    expect(err).not.toBeInstanceOf(DouyinUnreachableError);
  });

  it.each([403, 429])('F4: %i without an Argus body is a rate limit locked for the cooldown', (status) => {
    const err = classifyError(raw('', status));
    expect(err).toBeInstanceOf(DouyinRateLimitError);
    expect(err).toBeInstanceOf(PlatformRateLimitError);
    expect((err as DouyinRateLimitError).resetAt?.getTime()).toBe(NOW + COOLDOWN_MS);
    expect((err as Error).message).toMatch(new RegExp(`HTTP ${status}`));
  });

  it('F5: a 200 with an empty body asks for a retry; spent, it is a cooldown rate limit', async () => {
    const signal = classifyResponse(raw('   '), 'Douyin test', () => NOW);
    expect(signal).toBeInstanceOf(RetrySignal);
    const spent = await (signal as RetrySignal).exhausted();
    expect(spent).toBeInstanceOf(DouyinRateLimitError);
    expect((spent as DouyinRateLimitError).resetAt?.getTime()).toBe(NOW + COOLDOWN_MS);
  });

  it('F6: a 200 whose body is not JSON (a challenge page) is a verification stop with no reset', () => {
    const err = classifyError(raw('<!DOCTYPE html><html><title>验证码中间页</title></html>'));
    expect(err).toBeInstanceOf(DouyinRateLimitError);
    expect((err as DouyinRateLimitError).resetAt).toBeNull();
    expect((err as Error).message).toMatch(/验证码中间页/);
  });

  it.each([
    ['verify_center_decision_conf (object)', { verify_center_decision_conf: { verify_center_decision: 'verify_hit', decision_conf: { subtype: 'slide' } } }],
    ['verify_center_decision_conf (string)', { verify_center_decision_conf: '{"verify_center_decision":"verify_hit"}' }],
    ['verify_ticket', { verify_ticket: 'abc' }],
    ['captcha', { captcha: { type: 'slide' } }],
    ['nested verify_check key', { extra: { verify_check: { decision: 'block' } } }],
    ['verify_check as an envelope string value', { search_nil_info: { search_nil_type: 'verify_check' } }],
  ])('F6: %s stops with a verification rate limit', (_name, extra) => {
    const body = { status_code: 0, aweme_list: [], has_more: 1, ...extra };
    const err = classifyError(ok(body));
    expect(err).toBeInstanceOf(DouyinRateLimitError);
    expect((err as DouyinRateLimitError).resetAt).toBeNull();
  });

  it('F6 beats a non-zero status_code (the dtk risk fixture carries 10000)', () => {
    const err = classifyError(ok({ status_code: 10000, verify_center_decision_conf: { a: 1 } }));
    expect(err).toBeInstanceOf(DouyinRateLimitError);
  });

  it('an empty verify key is not a verification', () => {
    const body = collectionBody([], 0, 0, { verify_center_decision_conf: '', captcha: null, verify_ticket: {} });
    expect(classifyResponse(ok(body), 'Douyin test', () => NOW)).not.toBeInstanceOf(RetrySignal);
  });

  it('user content that mentions captcha / verify_check is not F6 (desc, nickname, folder name)', () => {
    const awemes = [
      rawAweme('1', { desc: 'how to beat a captcha — verify_check explained' }),
      rawAweme('2', {
        author: { sec_uid: 's', nickname: 'captcha_master', avatar_thumb: { url_list: [] } },
      }),
    ];
    expect(() =>
      classifyResponse(ok(collectionBody(awemes, 1789911201230543, 1)), 'Douyin test', () => NOW),
    ).not.toThrow();
    const folders = foldersBody([rawFolder('7300000000000000001', 'captcha verify_check', 1)], 1, false);
    expect(() => classifyResponse(ok(folders), 'Douyin test', () => NOW)).not.toThrow();
  });

  it('F7: status_code 8 + 用户未登录 is a missing login', () => {
    const err = classifyError(ok({ status_code: 8, status_msg: '用户未登录' }));
    expect(err).toBeInstanceOf(DouyinAuthError);
    expect(err).toBeInstanceOf(PlatformAuthError);
    expect((err as DouyinAuthError).reason).toBe('missing');
  });

  it('F7: status_code 2483 and a 请先登录 message are a missing login', () => {
    expect(classifyError(ok({ status_code: 2483, status_msg: '' }))).toBeInstanceOf(DouyinAuthError);
    expect(classifyError(ok({ status_code: 2190, status_msg: '请先登录' }))).toBeInstanceOf(
      DouyinAuthError,
    );
  });

  it('F9: a bare status_code 8 (no 未登录 message) is a status error, not a login', () => {
    const err = classifyError(ok({ status_code: 8, status_msg: 'something else' }));
    expect(err).toBeInstanceOf(DouyinStatusError);
    expect(err).not.toBeInstanceOf(DouyinAuthError);
  });

  it('F9: count ≥ 40 → status_code 5 + aweme_list null is a status error (probe #11), not an empty page', () => {
    const err = classifyError(ok({ status_code: 5, aweme_list: null }));
    expect(err).toBeInstanceOf(DouyinStatusError);
    expect(err).not.toBeInstanceOf(PlatformRateLimitError);
    expect((err as DouyinStatusError).statusCode).toBe(5);
    expect((err as Error).message).toMatch(/HTTP 200/);
    expect((err as Error).message).toMatch(/status_code 5/);
    expect((err as Error).message).toMatch(/"aweme_list":null/);
  });

  it('F9 carries status_msg into the message', () => {
    const err = classifyError(ok({ status_code: 2154, status_msg: 'risk' }));
    expect(err).toBeInstanceOf(DouyinStatusError);
    expect((err as DouyinStatusError).statusMsg).toBe('risk');
    expect((err as Error).message).toMatch(/risk/);
  });

  it('F11: a 5xx asks for a retry; spent, it is a plain Error with HTTP status and snippet', async () => {
    const signal = classifyResponse(raw('upstream down', 502), 'Douyin test', () => NOW);
    expect(signal).toBeInstanceOf(RetrySignal);
    const spent = await (signal as RetrySignal).exhausted();
    expect(spent).not.toBeInstanceOf(PlatformRateLimitError);
    expect(spent.message).toMatch(/HTTP 502/);
    expect(spent.message).toMatch(/upstream down/);
  });

  it('F11: an unreachable transport asks for a retry; spent, it is a plain Error naming the cause', async () => {
    const signal = classifyResponse(
      { kind: 'unreachable', message: 'tab closed' },
      'Douyin test',
      () => NOW,
    );
    expect(signal).toBeInstanceOf(RetrySignal);
    const spent = await (signal as RetrySignal).exhausted();
    expect(spent.message).toMatch(/tab closed/);
  });

  it('D: another non-2xx status is a plain Error, not retried', () => {
    const err = classifyError(raw('not found', 404));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RetrySignal);
    expect((err as Error).message).toMatch(/HTTP 404/);
  });

  it('D: JSON without a status_code, or a JSON array, is an unknown shape', () => {
    expect(classifyError(ok({ hello: 'world' }))).toBeInstanceOf(Error);
    expect((classifyError(ok({ hello: 'world' })) as Error).message).toMatch(/unexpected/i);
    expect(classifyError(ok([1, 2]))).toBeInstanceOf(Error);
  });

  it('quotes at most 300 characters of the body', () => {
    const err = classifyError(raw(`Blocked by ArgusSecurityPlugin ${'x'.repeat(1000)}`, 403));
    expect((err as Error).message.length).toBeLessThan(400);
  });
});

describe('findVerifyMarker', () => {
  it('scans keys everywhere but string values only outside the item lists', () => {
    expect(findVerifyMarker({ aweme_list: [{ desc: 'captcha' }] })).toBeNull();
    expect(findVerifyMarker({ collects_list: [{ collects_name: 'verify_ticket' }] })).toBeNull();
    expect(findVerifyMarker({ status_msg: 'please pass the captcha' })).toBe('captcha');
    expect(findVerifyMarker({ aweme_list: [{ verify_ticket: 't' }] })).toBe('verify_ticket');
  });

  it('treats aweme_detail as an item too: a caption about captchas is not a challenge (docs/37 D-h)', () => {
    expect(findVerifyMarker({ aweme_detail: { desc: 'how I beat the captcha' } })).toBeNull();
    expect(findVerifyMarker({ aweme_detail: { verify_ticket: 't' } })).toBe('verify_ticket');
  });
});

// ---------------------------------------------------------------------------
// Pacer — docs/33 §4.5 + design A (every real request, retries included)
// ---------------------------------------------------------------------------

describe('createDouyinPacer', () => {
  it('does not wait before the first request, then waits MIN + rand·JITTER before each next one', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const random = vi.fn(() => 0.5);
    const pacer = createDouyinPacer({ sleep, random });

    await pacer.beforeRequest();
    expect(sleep).not.toHaveBeenCalled();

    await pacer.beforeRequest();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenLastCalledWith(5_000 + 0.5 * 3_000);
  });

  it('keeps the page delay inside [MIN, MIN + JITTER)', async () => {
    const delays: number[] = [];
    const randoms = [0, 0.999999];
    const pacer = createDouyinPacer({
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => randoms.shift() ?? 0,
    });
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    expect(delays).toHaveLength(2);
    for (const ms of delays) {
      expect(ms).toBeGreaterThanOrEqual(5_000);
      expect(ms).toBeLessThan(8_000);
    }
  });

  it('adds one rest after every 25 requests, on top of the page delay', async () => {
    const delays: number[] = [];
    const pacer = createDouyinPacer({
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
    });
    for (let i = 0; i < 52; i += 1) await pacer.beforeRequest();

    // 51 waits of 5000 ms page delay + rests before request 26 and request 51.
    const rests = delays.filter((ms) => ms >= 60_000);
    expect(rests).toEqual([60_000, 60_000]);
    expect(delays.filter((ms) => ms === 5_000)).toHaveLength(51);
    // Request 26 is the 25th wait: page delay, then the rest.
    expect(delays.slice(24, 26)).toEqual([5_000, 60_000]);
  });
});

// The transcription-only pacer (docs/37 D4 / §4.5): one interval between
// consecutive aweme/detail requests, measured from the previous request's
// send time, no long rest. A clock is injected so the "time already elapsed"
// cases need no real waiting.
describe('createDouyinDetailPacer', () => {
  it('does not wait before the first request', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const pacer = createDouyinDetailPacer({ sleep, random: () => 0.5, now: () => 0 });
    await pacer.beforeRequest();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits only the remainder of MIN + rand·JITTER since the previous request was sent', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let clock = 0;
    const pacer = createDouyinDetailPacer({ sleep, random: () => 0.5, now: () => clock });
    await pacer.beforeRequest();
    clock = 1_000;
    await pacer.beforeRequest();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenLastCalledWith(5_000 + 0.5 * 3_000 - 1_000);
  });

  it('keeps the interval inside [MIN, MIN + JITTER) when no time has passed', async () => {
    const delays: number[] = [];
    const randoms = [0, 0.999999];
    const pacer = createDouyinDetailPacer({
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => randoms.shift() ?? 0,
      now: () => 0,
    });
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    expect(delays).toHaveLength(2);
    for (const ms of delays) {
      expect(ms).toBeGreaterThanOrEqual(5_000);
      expect(ms).toBeLessThan(8_000);
    }
  });

  it('does not sleep at all when the previous request is already ≥ MIN + JITTER ago (the ASR path took longer)', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let clock = 0;
    const pacer = createDouyinDetailPacer({ sleep, random: () => 0.999999, now: () => clock });
    await pacer.beforeRequest();
    clock = 8_000;
    await pacer.beforeRequest();
    expect(sleep).not.toHaveBeenCalled();
  });

  // The handler's pacer is ONE module-level instance for every TRANSCRIBE_AUDIO
  // in the Service Worker, so two sessions (two app.html tabs) can call it at
  // once. A caller that computed its wait from a `lastAt` the sleeping caller
  // has not updated yet would wake with it and send alongside it: the pacer
  // must queue callers, each measuring from the previous one's send time.
  // Fake timers + the real `sleep`: an injected clock that advances inside
  // `sleep` is sequential by construction and cannot show this race.
  it('serialises concurrent callers: the second waits a full interval behind the first, not alongside it', async () => {
    vi.useFakeTimers();
    const pacer = createDouyinDetailPacer({ random: () => 0 });
    await pacer.beforeRequest();
    const sent: string[] = [];
    const a = pacer.beforeRequest().then(() => sent.push('a'));
    const b = pacer.beforeRequest().then(() => sent.push('b'));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toEqual(['a', 'b']);
    await Promise.all([a, b]);
  });
});

describe('requestEnvelope — retries, pacing and checkpoints (fake timers)', () => {
  it('paces and checkpoints every attempt, the retry included (2 checkpoints per attempt)', async () => {
    vi.useFakeTimers();
    const beforeRequest = vi.fn(async () => {});
    const checkpoint = vi.fn(async () => {});
    const { transport } = scripted(raw('busy', 503), ok(collectionBody([], 0, 0)));

    const run = requestEnvelope(
      session(transport, { pacer: { beforeRequest }, control: { checkpoint } }),
      buildCollectionRequest('0'),
      'Douyin listcollection',
    );
    await vi.runAllTimersAsync();
    await expect(run).resolves.toMatchObject({ json: { status_code: 0 } });

    expect(transport).toHaveBeenCalledTimes(2);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenCalledTimes(4);
  });

  it('F5 and F11 share one budget of MAX_RETRIES (2): three attempts, then the last signal’s error', async () => {
    vi.useFakeTimers();
    const { transport } = scripted(raw(''), raw('down', 500), raw(''));
    const run = requestEnvelope(session(transport), buildCollectionRequest('0'), 'Douyin listcollection');
    const assertion = expect(run).rejects.toBeInstanceOf(DouyinRateLimitError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('the shared budget throws what the LAST signal builds: empty, empty, then 5xx is a plain Error', async () => {
    vi.useFakeTimers();
    const { transport } = scripted(raw(''), raw(''), raw('down', 500));
    const run = requestEnvelope(session(transport), buildCollectionRequest('0'), 'Douyin listcollection');
    const caught = run.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlatformRateLimitError);
    expect((err as Error).message).toMatch(/HTTP 500/);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('F11 spent on unreachable is a DouyinUnreachableError naming the cause', async () => {
    vi.useFakeTimers();
    const gone: DouyinTransportResult = { kind: 'unreachable', message: 'injection failed' };
    const { transport } = scripted(gone, gone, gone);
    const run = requestEnvelope(session(transport), buildFoldersRequest('0'), 'Douyin collects/list');
    const caught = run.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(DouyinUnreachableError);
    expect(err).not.toBeInstanceOf(PlatformRateLimitError);
    expect((err as Error).name).toBe('DouyinUnreachableError');
    expect((err as Error).message).toMatch(/injection failed/);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each<[string, DouyinTransportResult]>([
    ['F3 Argus 403', raw('Blocked by ArgusSecurityPlugin Uifid Not Found', 403)],
    ['F4 429', raw('', 429)],
    ['F6 challenge page', raw('<html>verify</html>')],
    ['F7 not logged in', ok({ status_code: 8, status_msg: '用户未登录' })],
    ['F9 status_code 5', ok({ status_code: 5, aweme_list: null })],
    ['F2 SDK not ready', { kind: 'sdk-not-ready' }],
  ])('%s is never retried', async (_name, result) => {
    const { transport } = scripted(result, ok(collectionBody([], 0, 0)));
    await expect(
      requestEnvelope(session(transport), buildCollectionRequest('0'), 'Douyin listcollection'),
    ).rejects.toBeInstanceOf(Error);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe('mapAweme', () => {
  it('maps a video aweme: string id, sec_uid author, ms duration, cover', () => {
    expect(mapAweme(rawAweme('7300000000000000001'))).toEqual({
      id: '7300000000000000001',
      desc: 'desc of 7300000000000000001 #topic',
      createTime: 1_758_000_000,
      author: {
        secUid: 'MS4wLjABAAAA_alice',
        nickname: 'Alice',
        avatarUrl: 'https://p3-pc.douyinpic.com/avatar.jpeg',
      },
      coverUrl: 'https://p3-pc.douyinpic.com/cover.jpeg',
      durationMs: 15_300,
      mediaKind: 'video',
    });
  });

  it('maps an image post (probe #7: aweme_type 68, 4 images, duration 0) as a note', () => {
    const note = mapAweme(
      rawAweme('7300000000000000002', {
        aweme_type: 68,
        media_type: 2,
        video: { duration: 0, cover: { url_list: [] } },
        images: [
          { url_list: ['https://p3/img1.webp'] },
          { url_list: ['https://p3/img2.webp'] },
          { url_list: [] },
          { url_list: [] },
        ],
      }),
    );
    expect(note?.mediaKind).toBe('note');
    expect(note?.durationMs).toBeNull();
    expect(note?.coverUrl).toBe('https://p3/img1.webp');
  });

  it('rejects an entry without a string aweme_id (a number has already lost its digits)', () => {
    expect(mapAweme({ ...rawAweme('1'), aweme_id: 7300000000000000001 })).toBeNull();
    expect(mapAweme({ ...rawAweme('1'), aweme_id: '' })).toBeNull();
    expect(mapAweme(null)).toBeNull();
  });

  it('tolerates a missing author / video / desc', () => {
    const mapped = mapAweme({ aweme_id: '9' });
    expect(mapped).toEqual({
      id: '9',
      desc: '',
      createTime: null,
      author: { secUid: '', nickname: '', avatarUrl: '' },
      coverUrl: null,
      durationMs: null,
      mediaKind: 'video',
    });
  });
});

describe('mapFolder', () => {
  it('uses collects_id_str, never the precision-lossy collects_id number', () => {
    expect(mapFolder(rawFolder('6910000000000000202', 'Public', 1))).toEqual({
      id: '6910000000000000202',
      title: 'Public',
      isPublic: true,
    });
  });

  it('status 1 is public; 0, an unmeasured value or a missing one is not', () => {
    expect(mapFolder(rawFolder('1', 'a', 0))?.isPublic).toBe(false);
    expect(mapFolder(rawFolder('1', 'a', 3))?.isPublic).toBe(false);
    expect(mapFolder(rawFolder('1', 'a', undefined))?.isPublic).toBe(false);
    expect(mapFolder(rawFolder('1', 'a', '1'))?.isPublic).toBe(false);
  });

  it('rejects an entry without collects_id_str', () => {
    expect(mapFolder({ collects_id: 1, collects_name: 'x', status: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Walks — cursor semantics, has_more shapes, F8 / F10, fuse
// ---------------------------------------------------------------------------

const C1 = 1789911201230543;
const C2 = 1789811201230543;

function collectPages(): { pages: DouyinAwemePage[]; onPage: (p: DouyinAwemePage) => Promise<'continue'> } {
  const pages: DouyinAwemePage[] = [];
  return {
    pages,
    onPage: async (page) => {
      pages.push(page);
      return 'continue';
    },
  };
}

describe('walkCollection', () => {
  it('follows the 16-digit µs cursor downwards until has_more 0', async () => {
    const { transport, requests } = scripted(
      ok(collectionBody([rawAweme('1'), rawAweme('2')], C1, 1)),
      ok(collectionBody([rawAweme('3')], C2, 0)),
    );
    const { pages, onPage } = collectPages();

    await expect(walkCollection(session(transport), '0', onPage)).resolves.toBe('end');

    expect(requests.map((r) => r.form?.cursor)).toEqual(['0', String(C1)]);
    expect(pages.map((p) => p.awemes.map((a) => a.id))).toEqual([['1', '2'], ['3']]);
    expect(pages[0]).toMatchObject({ hasMore: true, nextCursor: String(C1) });
    expect(pages[1]).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('accepts a short page (失效作品 dropped from the list) and keeps going — only has_more ends a walk', async () => {
    const { transport } = scripted(
      ok(collectionBody([rawAweme('1')], C1, 1, { disabled_item_ids: ['x'], invalid_item_id_list: ['x'] })),
      ok(collectionBody([], 0, 0)),
    );
    const { pages, onPage } = collectPages();
    await expect(walkCollection(session(transport), '0', onPage)).resolves.toBe('end');
    expect(pages[0].invalidCount).toBeGreaterThan(0);
  });

  it('F8 with 失效 ids: a wholly invalid page is a page, the walk continues', async () => {
    const { transport } = scripted(
      ok(collectionBody([], C1, 1, { disabled_item_ids: ['a', 'b'] })),
      ok(collectionBody([rawAweme('5')], C2, 0)),
    );
    const { pages, onPage } = collectPages();
    await expect(walkCollection(session(transport), '0', onPage)).resolves.toBe('end');
    expect(pages.map((p) => p.awemes.length)).toEqual([0, 1]);
  });

  it.each<[string, unknown[] | null]>([
    ['[]', []],
    ['null', null],
  ])('F8 without 失效 ids (aweme_list %s + has_more 1) soft-stops as a cooldown rate limit', async (_n, list) => {
    const { transport } = scripted(ok(collectionBody(list, C1, 1)));
    const onStartCursorRejected = vi.fn(async () => {});
    const err = await walkCollection(session(transport), '0', collectPages().onPage, {
      onStartCursorRejected,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DouyinRateLimitError);
    expect((err as DouyinRateLimitError).resetAt?.getTime()).toBe(NOW + COOLDOWN_MS);
    expect(onStartCursorRejected).toHaveBeenCalledTimes(1);
  });

  it('F9 on the first request calls onStartCursorRejected before the status error propagates; F4 does not', async () => {
    const onStartCursorRejected = vi.fn(async () => {});
    const f9 = scripted(ok({ status_code: 5, aweme_list: null }));
    await expect(
      walkCollection(session(f9.transport), String(C1), collectPages().onPage, {
        onStartCursorRejected,
      }),
    ).rejects.toBeInstanceOf(DouyinStatusError);
    expect(onStartCursorRejected).toHaveBeenCalledTimes(1);

    onStartCursorRejected.mockClear();
    const f4 = scripted(raw('', 403));
    await expect(
      walkCollection(session(f4.transport), String(C1), collectPages().onPage, {
        onStartCursorRejected,
      }),
    ).rejects.toBeInstanceOf(DouyinRateLimitError);
    expect(onStartCursorRejected).not.toHaveBeenCalled();
  });

  it('F9 after transient retries of the first request still counts as the start cursor being refused', async () => {
    vi.useFakeTimers();
    const onStartCursorRejected = vi.fn(async () => {});
    const { transport } = scripted(raw('busy', 503), ok({ status_code: 2154, status_msg: 'x' }));
    const run = walkCollection(session(transport), String(C1), collectPages().onPage, {
      onStartCursorRejected,
    });
    const assertion = expect(run).rejects.toBeInstanceOf(DouyinStatusError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onStartCursorRejected).toHaveBeenCalledTimes(1);
  });

  it.each<[string, DouyinTransportResult, unknown]>([
    ['F8', ok(collectionBody([], C2, 1)), DouyinRateLimitError],
    ['F9', ok({ status_code: 2154, status_msg: 'x' }), DouyinStatusError],
  ])('%s on a later page does NOT call onStartCursorRejected (a fresh cursor, not the stored one)', async (_name, refusal, errorClass) => {
    const onStartCursorRejected = vi.fn(async () => {});
    const { transport } = scripted(ok(collectionBody([rawAweme('1')], C1 - 1, 1)), refusal);
    await expect(
      walkCollection(session(transport), String(C1), collectPages().onPage, {
        onStartCursorRejected,
      }),
    ).rejects.toBeInstanceOf(errorClass);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onStartCursorRejected).not.toHaveBeenCalled();
  });

  it('legal zero: aweme_list [] + has_more 0 ends the walk with an empty page', async () => {
    const { transport } = scripted(ok(collectionBody([], 0, 0)));
    const { pages, onPage } = collectPages();
    await expect(walkCollection(session(transport), '0', onPage)).resolves.toBe('end');
    expect(pages).toHaveLength(1);
    expect(pages[0].awemes).toEqual([]);
  });

  it('D: a status_code 0 page without has_more is an unknown shape', async () => {
    const body = collectionBody([rawAweme('1')], C1, 1) as Record<string, unknown>;
    delete body.has_more;
    const { transport } = scripted(ok(body));
    await expect(walkCollection(session(transport), '0', collectPages().onPage)).rejects.toThrow(
      /has_more/,
    );
  });

  it.each<[string, number]>([
    ['repeats', C1],
    ['goes back up', C1 + 1],
  ])('F10: a cursor that %s stops the walk', async (_name, second) => {
    const { transport } = scripted(
      ok(collectionBody([rawAweme('1')], C1, 1)),
      ok(collectionBody([rawAweme('2')], second, 1)),
    );
    await expect(walkCollection(session(transport), '0', collectPages().onPage)).rejects.toThrow(
      /cursor/,
    );
  });

  it('F10: a later page whose cursor falls back to 0 ("from the top") stops the walk instead of looping', async () => {
    const { transport } = scripted(
      ok(collectionBody([rawAweme('1')], C1, 1)),
      ok(collectionBody([rawAweme('2')], 0, 1)),
      ok(collectionBody([rawAweme('1')], C1, 1)),
    );
    await expect(walkCollection(session(transport), '0', collectPages().onPage)).rejects.toThrow(
      /cursor did not advance/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('F10: has_more 1 with no usable cursor stops the walk', async () => {
    const { transport } = scripted(ok(collectionBody([rawAweme('1')], 0, 1)));
    await expect(walkCollection(session(transport), '0', collectPages().onPage)).rejects.toThrow(
      /cursor/,
    );
  });

  it('a resumed walk must move below its start cursor', async () => {
    const { transport } = scripted(ok(collectionBody([rawAweme('1')], C1, 1)));
    await expect(
      walkCollection(session(transport), String(C2), collectPages().onPage),
    ).rejects.toThrow(/cursor/);
  });

  it('F10 on the first request (the start cursor was not taken) calls onStartCursorRejected, then throws F10', async () => {
    const onStartCursorRejected = vi.fn(async () => {});
    const { transport } = scripted(ok(collectionBody([rawAweme('1')], C1, 1)));
    await expect(
      walkCollection(session(transport), String(C2), collectPages().onPage, {
        onStartCursorRejected,
      }),
    ).rejects.toThrow(/cursor did not advance/);
    expect(onStartCursorRejected).toHaveBeenCalledTimes(1);
  });

  it('F10 on a later page does NOT call onStartCursorRejected', async () => {
    const onStartCursorRejected = vi.fn(async () => {});
    const { transport } = scripted(
      ok(collectionBody([rawAweme('1')], C1 - 1, 1)),
      ok(collectionBody([rawAweme('2')], C1 - 1, 1)),
    );
    await expect(
      walkCollection(session(transport), String(C1), collectPages().onPage, {
        onStartCursorRejected,
      }),
    ).rejects.toThrow(/cursor did not advance/);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onStartCursorRejected).not.toHaveBeenCalled();
  });

  it('stops when onPage says stop', async () => {
    const { transport } = scripted(ok(collectionBody([rawAweme('1')], C1, 1)));
    await expect(walkCollection(session(transport), '0', async () => 'stop')).resolves.toBe(
      'stopped',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('the page fuse (MAX_PAGES = 200) ends a runaway walk quietly', async () => {
    let cursor = C1;
    const transport = vi.fn(async () => {
      cursor -= 1;
      return ok(collectionBody([rawAweme(String(cursor))], cursor, 1));
    });
    await expect(walkCollection(session(transport), '0', collectPages().onPage)).resolves.toBe(
      'fuse',
    );
    expect(transport).toHaveBeenCalledTimes(200);
  });
});

describe('fetchPublicFolders', () => {
  it('legal zero (probe #3): collects_list null + total_number 0 → no folders', async () => {
    const { transport, requests } = scripted(ok(foldersBody(null, 0, false)));
    await expect(fetchPublicFolders(session(transport))).resolves.toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('walks the offset cursor with a boolean has_more and keeps only status 1', async () => {
    const { transport, requests } = scripted(
      ok(foldersBody([rawFolder('6910000000000000202', 'Public', 1), rawFolder('6910000000000000201', 'Private', 0)], 2, true)),
      ok(foldersBody([rawFolder('6910000000000000203', 'Odd', 2), rawFolder('6910000000000000204', 'Pub2', 1)], 4, false)),
    );
    await expect(fetchPublicFolders(session(transport))).resolves.toEqual([
      { id: '6910000000000000202', title: 'Public', isPublic: true },
      { id: '6910000000000000204', title: 'Pub2', isPublic: true },
    ]);
    expect(requests.map((r) => r.query.cursor)).toEqual(['0', '2']);
  });

  it('F10: an offset that does not move forward stops the walk', async () => {
    const { transport } = scripted(
      ok(foldersBody([rawFolder('1', 'a', 1)], 2, true)),
      ok(foldersBody([rawFolder('2', 'b', 1)], 2, true)),
    );
    await expect(fetchPublicFolders(session(transport))).rejects.toThrow(/cursor/);
  });
});

describe('walkFolderItems', () => {
  it('pages a folder by offset with has_more 0/1 and no max_cursor', async () => {
    const { transport, requests } = scripted(
      ok({ aweme_list: [rawAweme('1'), rawAweme('2')], cursor: 2, has_more: 1, status_code: 0, sec_uid: '' }),
      ok({ aweme_list: [rawAweme('3')], cursor: 3, has_more: 0, status_code: 0, sec_uid: '' }),
    );
    const { pages, onPage } = collectPages();
    await expect(walkFolderItems(session(transport), '6910000000000000202', onPage)).resolves.toBe(
      'end',
    );
    expect(requests.map((r) => [r.query.collects_id, r.query.cursor])).toEqual([
      ['6910000000000000202', '0'],
      ['6910000000000000202', '2'],
    ]);
    expect(pages.flatMap((p) => p.awemes.map((a) => a.id))).toEqual(['1', '2', '3']);
  });

  it('legal zero: an empty folder is aweme_list [] + has_more 0', async () => {
    const { transport } = scripted(ok({ aweme_list: [], cursor: 0, has_more: 0, status_code: 0 }));
    await expect(walkFolderItems(session(transport), '1', collectPages().onPage)).resolves.toBe('end');
  });
});
