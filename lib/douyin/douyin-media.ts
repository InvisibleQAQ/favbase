/**
 * Douyin media facts as pure functions (docs/37 Step 1): decoding one
 * `aweme/detail` envelope, choosing the audio source URLs a transcription
 * downloads, and the one in-memory rule for which favorites get transcribed.
 *
 * Zero I/O, zero schema. This module is imported by the Background SW's
 * transcription handler (docs/37 Step 2) as well as by the sync service, so
 * it must NOT import `./douyin-sync-service`, `@/lib/database`, `@/lib/ingest`
 * or `@/lib/storage` — any of those pulls PGlite into the SW bundle
 * (`scripts/check-background-bundle.mjs`). Its only imports are the API
 * layer (types, the rate-limit error, the cooldown) and the body snippet.
 *
 * Shapes come from the 2026-10-08 live probe (task research
 * `douyin-step0-subtitle-media-probe-2026-10-08.md`); the fixtures in
 * `douyin-media.test.ts` replay them.
 */

import { textSnippet } from '@/lib/http/response-body';
import { cooldownFrom, DouyinRateLimitError, WHAT_DETAIL, type DouyinEnvelope } from './douyin-api';

/** The `aweme_detail` object — the same shape as an `aweme_list` entry (docs/37 §4.2). */
export type DouyinDetailPayload = Record<string, unknown>;

export type DouyinDetailDecoded =
  | { kind: 'aweme'; detail: DouyinDetailPayload }
  /** `status_code: 0` + `aweme_detail: null` + a `filter_detail` explaining why (docs/37 D-i). */
  | { kind: 'unavailable'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `filter_detail` that says something: a non-empty object or a non-empty string. */
function explains(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
}

/**
 * Decode a classified (`status_code: 0`) detail envelope. An object is the
 * aweme. A null / absent `aweme_detail` WITH a `filter_detail` is Douyin
 * saying the work is unavailable (only visible to its author, taken down):
 * a legitimate business answer, not risk control (D-i). The same empty
 * payload WITHOUT an explanation is the shape risk control takes — the list
 * endpoints' F8 — so it throws the same cooldown error. Any other type is an
 * unexpected shape.
 */
export function decodeDetail(
  env: DouyinEnvelope,
  now: () => number = Date.now,
): DouyinDetailDecoded {
  const raw = env.json.aweme_detail;
  if (isRecord(raw)) return { kind: 'aweme', detail: raw };
  if (raw === null || raw === undefined) {
    const filter = env.json.filter_detail;
    if (explains(filter)) {
      return {
        kind: 'unavailable',
        reason: textSnippet(typeof filter === 'string' ? filter : JSON.stringify(filter)),
      };
    }
    throw new DouyinRateLimitError(
      `${WHAT_DETAIL}: HTTP ${env.status} empty aweme_detail without filter_detail (payload withheld — risk control?): ${textSnippet(env.text)}`,
      cooldownFrom(now),
    );
  }
  throw new Error(
    `${WHAT_DETAIL}: HTTP ${env.status} unexpected response shape (aweme_detail is not an object): ${textSnippet(env.text)}`,
  );
}

function nonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * Tier 1: the first audio-only track (`video.bit_rate_audio[]`, DASH fMP4,
 * about a tenth of the smallest mp4). Its `url_list` is an OBJECT of three
 * named URLs, and the order is not negotiable: the probe measured `main_url`'s
 * host refusing a Referer-less Service Worker request with 403 while
 * `backup_url` and `fallback_url` answered 200.
 */
function audioTrackUrls(video: Record<string, unknown>): string[] {
  if (!Array.isArray(video.bit_rate_audio)) return [];
  for (const track of video.bit_rate_audio) {
    if (!isRecord(track) || !isRecord(track.audio_meta) || !isRecord(track.audio_meta.url_list)) continue;
    const list = track.audio_meta.url_list;
    const found = [list.main_url, list.backup_url, list.fallback_url].filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    );
    if (found.length > 0) return found;
  }
  return [];
}

interface Mp4Gear {
  bitRate: number;
  h264: boolean;
  urls: string[];
}

/**
 * Tier 2: the lowest-bit-rate `format: 'mp4'` gear, preferring `is_h265 === 0`.
 * Sorting every gear by `bit_rate` alone picks the wrong one: the probe's
 * lowest gear is usually h265 + bytevc1 AND `format: 'dash'`, which is
 * neither a file nor a codec the ASR upload is known to take.
 */
function lowestMp4Urls(video: Record<string, unknown>): string[] {
  if (!Array.isArray(video.bit_rate)) return [];
  const gears: Mp4Gear[] = [];
  for (const entry of video.bit_rate) {
    if (!isRecord(entry) || entry.format !== 'mp4' || !isRecord(entry.play_addr)) continue;
    const bitRate = entry.bit_rate;
    if (typeof bitRate !== 'number' || !Number.isFinite(bitRate)) continue;
    const urls = nonEmptyStrings(entry.play_addr.url_list);
    if (urls.length === 0) continue;
    gears.push({ bitRate, h264: entry.is_h265 === 0, urls });
  }
  const h264 = gears.filter((gear) => gear.h264);
  const pool = h264.length > 0 ? h264 : gears;
  let best: Mp4Gear | null = null;
  for (const gear of pool) if (best === null || gear.bitRate < best.bitRate) best = gear;
  return best ? best.urls : [];
}

/**
 * Every URL a transcription may download the audio from, in the order to
 * try them (docs/37 D-g, three tiers): the audio-only track's three URLs,
 * then the lowest H.264 mp4 gear's three, then `video.play_addr.url_list`.
 * All three tiers are listed rather than only the first that exists, so a
 * host that refuses the Service Worker is one failed attempt and not a
 * failed video: the downloader walks the list and moves on at any non-2xx.
 * Deduplicated, first position kept; `[]` when nothing is playable (an image
 * post, a deleted work).
 */
export function pickAudioSourceUrls(detail: DouyinDetailPayload): string[] {
  const video = isRecord(detail.video) ? detail.video : {};
  const playAddr = isRecord(video.play_addr) ? nonEmptyStrings(video.play_addr.url_list) : [];
  const ordered = [...audioTrackUrls(video), ...lowestMp4Urls(video), ...playAddr];
  return [...new Set(ordered)];
}

/**
 * Which favorites the transcription producer takes (docs/37 D-f): a video
 * with a known positive duration. Image posts and a video whose duration is
 * missing or 0 keep the post text as their Content. An in-memory rule only —
 * it is not a downstream-eligibility exclusion (an image post still gets
 * embedded and tagged), so it stays out of `PLATFORM_DOWNSTREAM_ELIGIBILITY`.
 * The parameter shape fits both `DouyinRawAweme` and `NarrowedDouyinMeta`.
 */
export function isTranscribableAweme(meta: {
  mediaKind: 'video' | 'note';
  durationMs: number | null;
}): boolean {
  return meta.mediaKind === 'video' && meta.durationMs !== null && meta.durationMs > 0;
}
