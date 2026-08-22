import { sql, type SQL } from 'drizzle-orm';

import { items } from '@/lib/database/entities/items';

import type { BiliFavVideo } from './types';

/**
 * Bilibili favorites API `attr` value for a taken-down / invalid video
 * (失效视频). A protocol fact, not a tunable: such a video has no page, no
 * subtitles and no audio, so it can neither be transcribed nor embedded or
 * tagged. This module is the single owner of that rule — the in-memory
 * predicate and the SQL predicate below must stay in parity
 * (`video-eligibility.test.ts`).
 */
export const INVALID_VIDEO_ATTR = 9;

/** In-memory gate for cards, manual transcription and the auto-transcribe feed. */
export function isProcessableVideo(video: Pick<BiliFavVideo, 'attr'>): boolean {
  return video.attr !== INVALID_VIDEO_ATTR;
}

/**
 * Same rule over persisted `items.platform_meta` for the shared Collection
 * processing policy. A missing `attr` reads as processable, mirroring the
 * `attr ?? 0` default used wherever a card is rebuilt from platform_meta.
 */
export function bilibiliDownstreamEligibleSql(): SQL {
  return sql<boolean>`coalesce(${items.platformMeta}->>'attr', '') <> ${String(INVALID_VIDEO_ATTR)}`;
}
