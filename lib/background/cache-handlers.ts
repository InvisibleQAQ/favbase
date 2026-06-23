import type { SubtitleRow } from '@/lib/types';
import type { CacheSubtitleRequest } from '@/lib/transcription/types';
import {
  getVideoCache,
  normalizeBvid,
  mergeVideoCache,
  computeRowsHash,
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
  const bvid = normalizeBvid(msg.bvid);
  const hash = computeRowsHash(msg.rows);
  return mergeVideoCache(bvid, {
    bvid,
    rows: msg.rows,
    source: msg.source,
    rawHash: hash,
    updatedAt: Date.now(),
  })
    .then(() => ({ success: true }))
    .catch((err) => {
      console.warn('[background] CACHE_SUBTITLE failed:', err);
      return { success: false };
    });
}
