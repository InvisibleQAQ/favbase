import type { SubtitleRow, CacheSubtitleRequest } from '@/lib/transcription/types';
import {
  getVideoCache,
  mergeVideoCache,
} from '@/lib/cache/video-cache';

export function handleGetVideoCache(
  msg: { bvid: string },
): Promise<{ rows: SubtitleRow[]; source: string; cached: true } | null> {
  return getVideoCache(msg.bvid).then((entry) => {
    if (!entry || entry.rows.length === 0) return null;
    return { rows: entry.rows, source: entry.source, cached: true as const };
  });
}

export function handleCacheSubtitle(
  msg: CacheSubtitleRequest,
): Promise<{ success: boolean }> {
  return mergeVideoCache(msg.bvid, msg.rows, msg.source)
    .then(() => ({ success: true }))
    .catch((err) => {
      console.warn('[background] CACHE_SUBTITLE failed:', err);
      return { success: false };
    });
}
