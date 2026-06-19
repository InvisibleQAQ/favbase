import { storage } from 'wxt/utils/storage';
import type { SubtitleRow } from '@/lib/types';
import type { VideoCacheEntry } from '@/lib/transcription/types';

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

export function computeRowsHash(rows: SubtitleRow[]): string {
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

function storageKey(bvid: string): `local:vc:${string}` {
  return `local:vc:${bvid}`;
}

// ---------------------------------------------------------------------------
// getCached — read with memory + storage + legacy migration
// ---------------------------------------------------------------------------

export async function getVideoCache(
  bvid: string,
): Promise<VideoCacheEntry | null> {
  // 1. Memory cache hit
  const mem = memoryCache.get(bvid);
  if (mem) return cloneData(mem);

  // 2. New per-bvid key
  const entry = await storage.getItem<VideoCacheEntry>(storageKey(bvid));
  if (entry) {
    memoryCache.set(bvid, cloneData(entry));
    return cloneData(entry);
  }

  // 3. Legacy migration
  const legacy = await legacyStorage.getValue();
  const legacyEntry = legacy[bvid];
  if (legacyEntry) {
    // Ensure rawHash exists on legacy entries
    const migrated: VideoCacheEntry = {
      ...legacyEntry,
      rawHash: legacyEntry.rawHash || computeRowsHash(legacyEntry.rows),
    };

    // Write to new key
    await storage.setItem(storageKey(bvid), migrated);
    memoryCache.set(bvid, cloneData(migrated));

    // Remove from legacy
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
  patch: Partial<VideoCacheEntry>,
): Promise<VideoCacheEntry> {
  return withWriteLock(bvid, async () => {
    const current = await storage.getItem<VideoCacheEntry>(storageKey(bvid));

    const merged: VideoCacheEntry = {
      ...CACHE_DEFAULTS,
      bvid,
      ...current,
      ...patch,
    };

    // Hash dedup: skip write if content unchanged
    if (current?.rawHash && current.rawHash === merged.rawHash) {
      return cloneData(current);
    }

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
// clearCache
// ---------------------------------------------------------------------------

export async function clearVideoCache(bvid: string): Promise<void> {
  await mergeVideoCache(bvid, {
    rows: [],
    rawHash: '',
    updatedAt: Date.now(),
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
      if (!key.startsWith('vc:')) continue;
      const bvid = key.slice(3);
      const newValue = changes[key].newValue as VideoCacheEntry | undefined;
      if (newValue) {
        memoryCache.set(bvid, cloneData(newValue));
      } else {
        memoryCache.delete(bvid);
      }
    }
  });
}
