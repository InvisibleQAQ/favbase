/**
 * Per-video summary cache — mirrors `lib/cache/video-cache.ts` (per-video key
 * under a registered prefix), minus the memory layer and write lock: summaries
 * are written once at the end of a generation, never concurrently merged.
 */

import { storage } from 'wxt/utils/storage';
import { STORAGE_PREFIXES } from '@/lib/storage/keys';
import type { SummaryResult } from './types';

const SUMMARY_PREFIX = STORAGE_PREFIXES.videoSummary;

function storageKey(platform: string, videoId: string): `local:vs:${string}` {
  return `local:${SUMMARY_PREFIX}${platform}:${videoId.toLowerCase()}`;
}

/**
 * Cached summary for a video, or null on a miss.
 *
 * `subtitleHash` guards staleness: pass the current `VideoCacheEntry.rawHash`
 * and a summary built from a different transcript (official → ASR re-run)
 * counts as a miss instead of silently describing the wrong text.
 */
export async function getSummaryCache(
  platform: string,
  videoId: string,
  subtitleHash?: string,
): Promise<SummaryResult | null> {
  const entry = await storage.getItem<SummaryResult>(storageKey(platform, videoId));
  if (!entry || !entry.markdown) return null;
  if (subtitleHash && entry.subtitleHash && entry.subtitleHash !== subtitleHash) return null;
  return entry;
}

export async function saveSummaryCache(
  platform: string,
  videoId: string,
  result: SummaryResult,
): Promise<void> {
  await storage.setItem(storageKey(platform, videoId), result);
}
