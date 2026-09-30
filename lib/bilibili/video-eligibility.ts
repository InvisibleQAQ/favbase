import { sql, type SQL } from 'drizzle-orm';

import { items } from '@/lib/database/entities/items';

import type { BiliFavVideo } from './types';

/**
 * Single owner of the Bilibili item `platform_meta` shape and of the
 * taken-down video rule that reads it. The shape (`BiliItemMeta`) is what
 * `videos-sync.ts` writes, `narrowBiliVideoMeta` is the one decoder every read
 * path uses, and the eligibility predicates below judge the same `attr` field
 * — in memory and in SQL — so all four stay in parity
 * (`video-eligibility.test.ts`, docs/20 中-8).
 */

/** `platform_meta` written to Bilibili `items` rows by `syncFavVideosToDb`. */
export type BiliItemMeta = Pick<
  BiliFavVideo,
  'cover' | 'intro' | 'duration' | 'cnt_info' | 'attr' | 'type' | 'fav_time'
>;

/**
 * Defensive narrowing of persisted Bilibili `platform_meta` — the SINGLE
 * source of truth for rebuilding a video from a stored row (the tagged card
 * adapter). Missing or mistyped fields read as `0` / `''`; `cnt_info` is
 * narrowed field by field, so a partial or malformed counter object never
 * leaks a non-number into the card. A missing `attr` reads as `0` — processable
 * — which is exactly how `bilibiliDownstreamEligibleSql` treats it.
 */
export function narrowBiliVideoMeta(meta: unknown): BiliItemMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === 'number' ? value : 0);
  const counters =
    typeof m.cnt_info === 'object' && m.cnt_info !== null
      ? (m.cnt_info as Record<string, unknown>)
      : {};
  return {
    cover: typeof m.cover === 'string' ? m.cover : '',
    intro: typeof m.intro === 'string' ? m.intro : '',
    duration: count(m.duration),
    cnt_info: {
      play: count(counters.play),
      collect: count(counters.collect),
      danmaku: count(counters.danmaku),
    },
    attr: count(m.attr),
    type: count(m.type),
    fav_time: count(m.fav_time),
  };
}

/**
 * Bilibili favorites API `attr` value for a taken-down / invalid video
 * (失效视频). A protocol fact, not a tunable: such a video has no page, no
 * subtitles and no audio, so it can neither be transcribed nor embedded or
 * tagged. The in-memory predicate and the SQL predicate below must stay in
 * parity (`video-eligibility.test.ts`).
 */
export const INVALID_VIDEO_ATTR = 9;

/** In-memory gate for cards, manual transcription and the auto-transcribe feed. */
export function isProcessableVideo(video: Pick<BiliFavVideo, 'attr'>): boolean {
  return video.attr !== INVALID_VIDEO_ATTR;
}

/**
 * Same rule over persisted `items.platform_meta` for the shared Collection
 * processing policy. A missing `attr` reads as processable, mirroring
 * `narrowBiliVideoMeta`'s `attr` default.
 */
export function bilibiliDownstreamEligibleSql(): SQL {
  return sql<boolean>`coalesce(${items.platformMeta}->>'attr', '') <> ${String(INVALID_VIDEO_ATTR)}`;
}
