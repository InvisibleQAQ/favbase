import { storage } from 'wxt/utils/storage';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import { STORAGE_KEYS, STORAGE_PREFIXES } from '@/lib/storage/keys';
import type { VideoCacheEntry } from './types';

// ---------------------------------------------------------------------------
// Video ID normalization — lowercase for cache key consistency.
// Callers are responsible for passing clean IDs (already extracted by
// platform-specific utilities like extractBvid).
// ---------------------------------------------------------------------------

export function normalizeVideoId(videoId: string): string {
  return videoId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Compound cache key — includes platform to prevent cross-platform collisions
// ---------------------------------------------------------------------------

function cacheKey(platform: string, videoId: string): string {
  return `${platform}:${normalizeVideoId(videoId)}`;
}

// ---------------------------------------------------------------------------
// Deep clone
// ---------------------------------------------------------------------------

export function cloneData<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// ---------------------------------------------------------------------------
// Hash — lightweight fingerprint (aligned with Bilitato, NOT crypto SHA-256)
// ---------------------------------------------------------------------------

function computeRowsHash(rows: SubtitleRow[]): string {
  if (!rows.length) return 'empty';
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `${rows.length}|${first.start}|${last.end ?? last.start}|${first.text.slice(0, 24)}|${last.text.slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Quota error detection
// ---------------------------------------------------------------------------

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /QUOTA_BYTES|quota exceeded/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Write lock — Promise-based per-key mutex
// ---------------------------------------------------------------------------

const writeLocks = new Map<string, Promise<void>>();

function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const result = prev.catch(() => {}).then(fn);
  const thisLock = result.then(
    () => {},
    () => {},
  );
  writeLocks.set(key, thisLock);

  return result.finally(() => {
    if (writeLocks.get(key) === thisLock) {
      writeLocks.delete(key);
    }
  });
}

// ---------------------------------------------------------------------------
// Memory cache (Background SW only — lives as long as SW is alive)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, VideoCacheEntry>();

// ---------------------------------------------------------------------------
// Legacy single-key storage (for migration)
// ---------------------------------------------------------------------------

const legacyStorage = storage.defineItem<Record<string, VideoCacheEntry>>(
  STORAGE_KEYS.videoCacheLegacy,
  { fallback: {} },
);

// ---------------------------------------------------------------------------
// Storage key helper
// ---------------------------------------------------------------------------

const CACHE_PREFIX = STORAGE_PREFIXES.videoCache;

function storageKey(platform: string, videoId: string): `local:vc:${string}` {
  return `local:${CACHE_PREFIX}${cacheKey(platform, videoId)}`;
}

// ---------------------------------------------------------------------------
// source migration — normalize legacy 'bilibili'/'groq' → 'official'/'asr'
// ---------------------------------------------------------------------------

const SOURCE_MIGRATION: Record<string, SubtitleSource> = {
  bilibili: 'official',
  groq: 'asr',
};

function normalizeSource(source: string): SubtitleSource {
  return SOURCE_MIGRATION[source] ?? (source as SubtitleSource);
}

// ---------------------------------------------------------------------------
// getCached — read with memory + storage + legacy migration
// ---------------------------------------------------------------------------

export async function getVideoCache(
  platform: string,
  videoId: string,
): Promise<VideoCacheEntry | null> {
  const key = cacheKey(platform, videoId);

  // 1. Memory cache hit
  const mem = memoryCache.get(key);
  if (mem && mem.rows.length > 0) return cloneData(mem);

  // 2. Per-video key (new format: vc:{platform}:{videoId})
  const entry = await storage.getItem<VideoCacheEntry>(storageKey(platform, videoId));
  if (entry && entry.rows.length > 0) {
    entry.source = normalizeSource(entry.source);
    memoryCache.set(key, cloneData(entry));
    return cloneData(entry);
  }

  // 3. Legacy migration (old single-key format → new per-video key)
  const legacy = await legacyStorage.getValue();
  const normalized = normalizeVideoId(videoId);
  const legacyEntry = legacy[normalized];
  if (legacyEntry && legacyEntry.rows.length > 0) {
    const migrated: VideoCacheEntry = {
      ...legacyEntry,
      platform,
      videoId: normalized,
      source: normalizeSource(legacyEntry.source),
      rawHash: legacyEntry.rawHash || computeRowsHash(legacyEntry.rows),
    };

    await storage.setItem(storageKey(platform, videoId), migrated);
    memoryCache.set(key, cloneData(migrated));

    delete legacy[normalized];
    if (Object.keys(legacy).length === 0) {
      await legacyStorage.removeValue();
    } else {
      await legacyStorage.setValue(legacy);
    }

    return cloneData(migrated);
  }

  return null;
}

// ---------------------------------------------------------------------------
// mergeCache — write with lock + hash dedup + quota fallback
// ---------------------------------------------------------------------------

const CACHE_DEFAULTS: Omit<VideoCacheEntry, 'platform' | 'videoId'> = {
  rows: [],
  source: 'official',
  rawHash: '',
  updatedAt: 0,
};

export async function mergeVideoCache(
  platform: string,
  videoId: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<VideoCacheEntry> {
  const key = cacheKey(platform, videoId);
  const rawHash = computeRowsHash(rows);

  return withWriteLock(key, async () => {
    const current = await storage.getItem<VideoCacheEntry>(storageKey(platform, videoId));

    if (current?.rawHash && current.rawHash === rawHash) {
      return cloneData(current);
    }

    const merged: VideoCacheEntry = {
      ...CACHE_DEFAULTS,
      platform,
      videoId: normalizeVideoId(videoId),
      ...current,
      rows,
      source,
      rawHash,
      updatedAt: Date.now(),
    };

    try {
      await storage.setItem(storageKey(platform, videoId), merged);
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn('[video-cache] Quota exceeded for', key, err);
        throw err;
      }
      throw err;
    }

    memoryCache.set(key, cloneData(merged));
    return cloneData(merged);
  });
}

// ---------------------------------------------------------------------------
// Background-side storage change listener (keeps memoryCache in sync)
// ---------------------------------------------------------------------------

export function initCacheStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const rawKey of Object.keys(changes)) {
      if (!rawKey.startsWith(CACHE_PREFIX)) continue;
      const suffix = rawKey.slice(CACHE_PREFIX.length);
      // New format: vc:{platform}:{videoId} — suffix contains ':'
      // Old format: vc:{bvid} — no ':', ignore gracefully
      if (!suffix.includes(':')) continue;
      const newValue = changes[rawKey].newValue as VideoCacheEntry | undefined;
      if (newValue) {
        newValue.source = normalizeSource(newValue.source);
        memoryCache.set(suffix, cloneData(newValue));
      } else {
        memoryCache.delete(suffix);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Per-video storage change subscription (Content Script side)
// ---------------------------------------------------------------------------

export function onVideoCacheChange(
  platform: string,
  videoId: string,
  cb: (entry: VideoCacheEntry) => void,
): () => void {
  const key = cacheKey(platform, videoId);
  const targetKey = CACHE_PREFIX + key;

  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    if (!changes[targetKey]) return;
    const newValue = changes[targetKey].newValue as VideoCacheEntry | undefined;
    if (newValue && newValue.rows.length > 0) {
      newValue.source = normalizeSource(newValue.source);
      cb(newValue);
    }
  };

  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
