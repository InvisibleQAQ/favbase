import { storage } from 'wxt/utils/storage';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type { VideoCacheEntry } from './types';

// ---------------------------------------------------------------------------
// BVID normalization — extractBvid preserves original case for API
// compatibility; this function lowercases for cache key consistency
// ---------------------------------------------------------------------------

export function normalizeBvid(bvid: string): string {
  const match = bvid.match(/BV[0-9A-Za-z]+/i);
  return match ? match[0].toLowerCase() : bvid.toLowerCase();
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
// Write lock — Promise-based per-bvid mutex
// ---------------------------------------------------------------------------

const writeLocks = new Map<string, Promise<void>>();

async function withWriteLock<T>(bvid: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(bvid) ?? Promise.resolve();
  const result = prev.catch(() => {}).then(fn);
  const thisLock = result.then(
    () => {},
    () => {},
  );
  writeLocks.set(bvid, thisLock);
  try {
    return await result;
  } finally {
    if (writeLocks.get(bvid) === thisLock) {
      writeLocks.delete(bvid);
    }
  }
}

// ---------------------------------------------------------------------------
// Memory cache (Background SW only — lives as long as SW is alive)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, VideoCacheEntry>();

// ---------------------------------------------------------------------------
// Legacy single-key storage (for migration)
// ---------------------------------------------------------------------------

const legacyStorage = storage.defineItem<Record<string, VideoCacheEntry>>(
  'local:videoCache',
  { fallback: {} },
);

// ---------------------------------------------------------------------------
// Storage key helper
// ---------------------------------------------------------------------------

const CHROME_KEY_PREFIX = 'vc:';

function storageKey(bvid: string): `local:vc:${string}` {
  return `local:${CHROME_KEY_PREFIX}${bvid}`;
}

// ---------------------------------------------------------------------------
// getCached — read with memory + storage + legacy migration
// ---------------------------------------------------------------------------

export async function getVideoCache(
  bvid: string,
): Promise<VideoCacheEntry | null> {
  bvid = normalizeBvid(bvid);

  // 1. Memory cache hit
  const mem = memoryCache.get(bvid);
  if (mem && mem.rows.length > 0) return cloneData(mem);

  // 2. New per-bvid key
  const entry = await storage.getItem<VideoCacheEntry>(storageKey(bvid));
  if (entry && entry.rows.length > 0) {
    memoryCache.set(bvid, cloneData(entry));
    return cloneData(entry);
  }

  // 3. Legacy migration
  const legacy = await legacyStorage.getValue();
  const legacyEntry = legacy[bvid];
  if (legacyEntry && legacyEntry.rows.length > 0) {
    const migrated: VideoCacheEntry = {
      ...legacyEntry,
      rawHash: legacyEntry.rawHash || computeRowsHash(legacyEntry.rows),
    };

    await storage.setItem(storageKey(bvid), migrated);
    memoryCache.set(bvid, cloneData(migrated));

    delete legacy[bvid];
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

const CACHE_DEFAULTS: Omit<VideoCacheEntry, 'bvid'> = {
  rows: [],
  source: 'bilibili',
  rawHash: '',
  updatedAt: 0,
};

export async function mergeVideoCache(
  bvid: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<VideoCacheEntry> {
  bvid = normalizeBvid(bvid);
  const rawHash = computeRowsHash(rows);

  return withWriteLock(bvid, async () => {
    const current = await storage.getItem<VideoCacheEntry>(storageKey(bvid));

    // Hash dedup: skip write if content unchanged
    if (current?.rawHash && current.rawHash === rawHash) {
      return cloneData(current);
    }

    const merged: VideoCacheEntry = {
      ...CACHE_DEFAULTS,
      bvid,
      ...current,
      rows,
      source,
      rawHash,
      updatedAt: Date.now(),
    };

    // Attempt storage write
    try {
      await storage.setItem(storageKey(bvid), merged);
    } catch (err) {
      if (isQuotaError(err)) {
        // Quota fallback: for now entry is light, but future Step 3 fields
        // (summary, segments) would be dropped here. Currently just rethrow
        // since we only have rows + source + rawHash + updatedAt.
        console.warn('[video-cache] Quota exceeded for', bvid, err);
        throw err;
      }
      throw err;
    }

    memoryCache.set(bvid, cloneData(merged));
    return cloneData(merged);
  });
}

// ---------------------------------------------------------------------------
// Background-side storage change listener (keeps memoryCache in sync)
// ---------------------------------------------------------------------------

export function initCacheStorageListener(): void {
  // WXT storage keys use `local:vc:{bvid}` in API, but chrome.storage.local
  // stores them as `vc:{bvid}` (the `local:` prefix is stripped).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (!key.startsWith(CHROME_KEY_PREFIX)) continue;
      const bvid = key.slice(CHROME_KEY_PREFIX.length);
      const newValue = changes[key].newValue as VideoCacheEntry | undefined;
      if (newValue) {
        memoryCache.set(bvid, cloneData(newValue));
      } else {
        memoryCache.delete(bvid);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Per-bvid storage change subscription (Content Script side)
// ---------------------------------------------------------------------------

export function onVideoCacheChange(
  bvid: string,
  cb: (entry: VideoCacheEntry) => void,
): () => void {
  const normalized = normalizeBvid(bvid);
  const targetKey = CHROME_KEY_PREFIX + normalized;

  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    if (!changes[targetKey]) return;
    const newValue = changes[targetKey].newValue as VideoCacheEntry | undefined;
    if (newValue && newValue.rows.length > 0) {
      cb(newValue);
    }
  };

  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
