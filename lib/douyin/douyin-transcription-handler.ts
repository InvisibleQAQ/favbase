/**
 * Douyin transcription handler — the Service Worker side of `TRANSCRIBE_AUDIO
 * { platform: 'douyin' }` (docs/37 Step 2), shaped like
 * `lib/bilibili/bilibili-transcription-handler.ts`: assemble the platform's
 * `PipelineDeps`, run the shared pipeline, push the terminal failure to the
 * tab. Registered in `lib/background/transcription-handlers.ts`.
 *
 * Import rules (docs/37 iron rule 2 — this module sits on the Service
 * Worker's static graph, which must stay free of PGlite): only
 * `./douyin-api`, `./douyin-tab`, `./douyin-media`,
 * `@/lib/background/transcription-utils` and the pipeline / types / cache /
 * `@/lib/storage/settings` leaves. Never `./douyin-sync-service`,
 * `@/lib/database*`, `@/lib/ingest*`, the `@/lib/collections` or
 * `@/lib/storage` barrels, and never `@/lib/background/transcription-handlers`
 * (a cycle). Guard: `tests/agent-bridge-background-bundle-contract.test.ts`.
 *
 * The detail request is NOT a prepare step ahead of the pipeline: it runs
 * inside the ASR path's URL extractor (info.md Step 2 ruling 1). The pipeline
 * consults the subtitle cache and checks the ASR key first, so a cache hit
 * (the D7 backlog after a restart) or a missing key spends no signed request
 * and no pacer interval, and needs no douyin.com tab at all. Of a detail
 * response only the candidate URL list is kept, per aweme id and for far less
 * than the CDN links' own expiry (about 3 h for video, 24 h for the
 * audio-only track): a retry after a temporary rate limit then downloads
 * again without a second signed request (docs/38). The audio bytes are never
 * kept.
 */

import { createTranscribeAudio, notifyTab } from '@/lib/background/transcription-utils';
import type { BackgroundContext } from '@/lib/background/types';
import { getVideoCache, mergeVideoCache } from '@/lib/cache/video-cache';
import { getAsrSettings } from '@/lib/storage/settings';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import { runTranscriptionPipeline } from '@/lib/transcription/pipeline';
import {
  createErrorInfo,
  isTranscribeError,
  type TranscribeErrorInfo,
  type TranscribeRequest,
  type TranscribeResponse,
} from '@/lib/transcription/types';
import {
  buildDetailRequest,
  createDouyinAudioUrlMemo,
  createDouyinDetailPacer,
  DouyinAuthError,
  DouyinRateLimitError,
  DouyinSignatureError,
  DouyinStatusError,
  DouyinUnreachableError,
  requestEnvelope,
  WHAT_DETAIL,
  type DouyinAudioUrlMemo,
  type DouyinPacer,
  type DouyinTransport,
} from './douyin-api';
import { decodeDetail, pickAudioSourceUrls, type DouyinDetailDecoded } from './douyin-media';
import { douyinTabTransport, findDouyinTab } from './douyin-tab';

/** Cache namespace (`local:vc:douyin:<aweme_id>`), the platform id as every platform passes it. */
const PLATFORM = 'douyin';

export interface DouyinTranscribeSession {
  /** The T1 gate; the same resolver the transport uses (docs/33 D-c). */
  findTab: () => Promise<number | null>;
  transport: DouyinTransport;
  pacer: DouyinPacer;
  /** Candidate URLs of recently resolved awemes, consulted before the T1 gate (docs/38). */
  audioUrls: DouyinAudioUrlMemo;
  /** Clock for the cooldown arithmetic and the memo's TTL; defaults to `Date.now`. */
  now?: () => number;
}

export type DouyinTranscribeHandler = (
  msg: TranscribeRequest,
  tabId: number,
  ctx: BackgroundContext,
  signal: AbortSignal,
) => Promise<TranscribeResponse>;

function secondsUntil(resetAt: Date, now: () => number): number {
  return Math.max(0, Math.ceil((resetAt.getTime() - now()) / 1000));
}

/**
 * docs/37 §4.3 folded by CLASS, never by message text: subclasses before
 * their bases, the platform's own classes before a generic `Error`. The
 * `message` is the thrown one — it already carries the HTTP status and a
 * 300-character body snippet, which is the only way an [UNKNOWN] shape
 * becomes a known one. `params.reason` is what the auto-transcribe adapter
 * (docs/37 Step 3) reads to decide between parking the session and failing
 * the one video:
 *   - `DOUYIN_TAB_MISSING`: `'closed'` (no tab / T2) | `'login'` (T5) | `'verify'` (T4′)
 *   - `DOUYIN_SIGNATURE_REJECTED`: `'argus'` (T3) | `'sdk-not-ready'` (T2′)
 *   - `DOUYIN_MEDIA_UNAVAILABLE`: the `filter_detail` text (T6)
 * `DOUYIN_RATE_LIMITED` carries `retryAfter` in seconds and nothing else:
 * `resetAt` + `providerId` is the ASR quota shape and is not borrowed.
 */
function toTranscribeErrorInfo(err: unknown, now: () => number): TranscribeErrorInfo {
  if (isTranscribeError(err)) return err;
  if (err instanceof DouyinRateLimitError) {
    if (err.resetAt !== null) {
      // T4 (403 / 429 without Argus, an empty 200 after retries) and the withheld detail payload.
      return {
        ...createErrorInfo('DOUYIN_RATE_LIMITED', err.message),
        retryAfter: secondsUntil(err.resetAt, now),
      };
    }
    // T4′: a verification page — only the user can clear it, in the douyin.com tab.
    return createErrorInfo('DOUYIN_TAB_MISSING', err.message, { reason: 'verify' });
  }
  if (err instanceof DouyinAuthError) {
    // T5: not logged in — the user signs in, in the douyin.com tab.
    return createErrorInfo('DOUYIN_TAB_MISSING', err.message, { reason: 'login' });
  }
  if (err instanceof DouyinSignatureError) {
    // T2′ / T3: the user reloads the douyin.com tab.
    return createErrorInfo('DOUYIN_SIGNATURE_REJECTED', err.message, { reason: err.reason });
  }
  if (err instanceof DouyinUnreachableError) {
    // T2: the tab went away (or never answered) and the shared transient budget is spent.
    return createErrorInfo('DOUYIN_TAB_MISSING', err.message, { reason: 'closed' });
  }
  if (err instanceof DouyinStatusError) {
    // T11
    return createErrorInfo('ASR_UNKNOWN', err.message, {
      detail: `status_code ${err.statusCode}${err.statusMsg ? ` (${err.statusMsg})` : ''}`,
    });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return createErrorInfo('ASR_UNKNOWN', detail, { detail });
}

/**
 * The ASR path's URL extractor: the memo first (a fresh hit answers with no
 * tab, no pacer and no request), then the T1 gate, then one paced,
 * page-signed detail request through the shared transient budget
 * (unreachable / 5xx / empty 200 retry; 403 / 429 never do), then decode,
 * then the D-g candidate list, which is memoised. The pacer wait and the
 * injected request do not observe `signal`, so an abort is checked once they
 * return. Every failure leaves as a `TranscribeErrorInfo` (or the abort),
 * which `createTranscribeAudio` passes through untouched, and stores nothing.
 */
async function resolveAudioSources(
  session: DouyinTranscribeSession,
  videoId: string,
  signal: AbortSignal,
): Promise<string[]> {
  const now = session.now ?? Date.now;

  const memoised = session.audioUrls.get(videoId, now());
  if (memoised) return memoised;

  // T1 — ahead of the pacer: a plainly absent tab costs no wait and no request.
  if ((await session.findTab()) === null) {
    throw createErrorInfo(
      'DOUYIN_TAB_MISSING',
      `${WHAT_DETAIL}: no usable www.douyin.com tab (closed, discarded or still loading)`,
      { reason: 'closed' },
    );
  }

  let decoded: DouyinDetailDecoded;
  try {
    const env = await requestEnvelope(
      { transport: session.transport, pacer: session.pacer, now },
      buildDetailRequest(videoId),
      WHAT_DETAIL,
    );
    decoded = decodeDetail(env, now);
  } catch (err) {
    throw toTranscribeErrorInfo(err, now);
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  if (decoded.kind === 'unavailable') {
    // T6: a legitimate business answer (only the author can see it, taken down), not risk control.
    throw createErrorInfo(
      'DOUYIN_MEDIA_UNAVAILABLE',
      `${WHAT_DETAIL}: work ${videoId} is unavailable: ${decoded.reason}`,
      { reason: decoded.reason },
    );
  }

  // Ruling 5 (docs/29's lesson): a detail answered for another work is never transcribed as this one.
  const echoed = decoded.detail.aweme_id;
  if (echoed !== videoId) {
    const detail = `aweme/detail answered for ${String(echoed)} instead of ${videoId}`;
    throw createErrorInfo('ASR_UNKNOWN', `${WHAT_DETAIL}: ${detail}`, { detail });
  }

  const urls = pickAudioSourceUrls(decoded.detail);
  if (urls.length === 0) {
    // T7: an image post that slipped in, a deleted work.
    throw createErrorInfo('ASR_NO_AUDIO_SOURCE', `${WHAT_DETAIL}: no playable audio source for ${videoId}`);
  }
  session.audioUrls.set(videoId, urls, now());
  return urls;
}

export function createDouyinTranscribeHandler(session: DouyinTranscribeSession): DouyinTranscribeHandler {
  return async (msg, tabId, ctx, signal) => {
    const { videoId, title } = msg;

    const deps = {
      getAsrConfig: getAsrSettings,
      // Step 0 (2026-10-08): `cla_info` was empty in 136 / 136 samples; v1 never reads it (docs/37 §4.2).
      fetchOfficialSubtitle: async () => null,
      transcribeAudio: createTranscribeAudio(tabId, ctx, (id) => resolveAudioSources(session, id, signal)),
      cacheGet: async (id: string) => {
        const entry = await getVideoCache(PLATFORM, id);
        if (!entry) return null;
        return { rows: entry.rows, source: entry.source };
      },
      cacheSave: async (id: string, rows: SubtitleRow[], source: SubtitleSource) => {
        await mergeVideoCache(PLATFORM, id, rows, source);
      },
      // D-b: the interaction-phrase filter is Bilibili's; Douyin rows pass as they are.
      postProcess: (rows: SubtitleRow[]) => rows,
    };

    const result = await runTranscriptionPipeline(
      {
        videoId,
        // Bilibili's page id; meaningless here. The request type keeps it a number.
        cid: 0,
        title,
        signal,
        officialSourceLabel: 'official',
        asrSourceLabel: 'asr',
      },
      deps,
      (progress, stage, stageParams) => {
        notifyTab(ctx, tabId, videoId, progress, stage, undefined, stageParams);
      },
    );
    if (!result.success) {
      notifyTab(ctx, tabId, videoId, 0, 'failed', result.error);
    }
    return result;
  };
}

/** One pacer per Service Worker life: every `TRANSCRIBE_AUDIO` for douyin shares it (docs/37 §4.5). */
const detailPacer = createDouyinDetailPacer();
/** Likewise one candidate memo per Service Worker life (docs/38). */
const audioUrlMemo = createDouyinAudioUrlMemo();

export const handleDouyinTranscribe: DouyinTranscribeHandler = createDouyinTranscribeHandler({
  findTab: findDouyinTab,
  transport: douyinTabTransport,
  pacer: detailPacer,
  audioUrls: audioUrlMemo,
});
