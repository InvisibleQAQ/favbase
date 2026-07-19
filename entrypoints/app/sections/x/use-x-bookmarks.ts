import { useCallback, useEffect, useState } from 'react';

import {
  syncBookmarks,
  getBookmarks,
  getAuthorCounts,
  getLastSyncedAt,
  type XBookmarkItem,
  type AuthorCount,
} from '@/lib/x/x-sync-service';
import { getXAuth } from '@/lib/x/x-auth';
import { classifyXSyncError, type XSyncError } from '@/lib/x/x-messages';
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';
import { xLastSyncStorage, type XLastSync } from '@/lib/storage';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import { COOLDOWN_MS, remainingCooldown } from './cooldown';

// Re-exported so the view keeps importing XSyncError from the hook; the type +
// classifier live in lib/x (shared classifier; single trigger surface now).
export type { XSyncError };

/** Progress for the (cursor-paginated) X sync — total is unknowable, so this is
 *  always indeterminate; we surface the running fetched count + page number. */
export interface XSyncProgress {
  fetchedCount: number;
  page: number;
}

export interface UseXBookmarksReturn {
  // Paged query results (from PGlite via x-sync-service — no API reads)
  bookmarks: XBookmarkItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Filters
  author: string | null;
  setAuthor: (author: string | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta (unfiltered)
  authors: AuthorCount[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // One-shot bookmarks sync (manual button — never auto-on-mount, D5)
  syncing: boolean;
  syncProgress: XSyncProgress | null;
  syncError: XSyncError | null;
  sync: () => Promise<void>;

  // X-specific: last-sync "N new this run" (persisted) + sync cooldown.
  lastInserted: number | null;
  /** Ms remaining before the sync button can be pressed again (0 = ready). */
  cooldownRemainingMs: number;
}

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getBookmarks({
    author: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

/** Thin adapter over the shared collection-library state machine. */
export function useXBookmarks(): UseXBookmarksReturn {
  // "N new this run" — seeded from storage so it survives a reload, refreshed
  // synchronously the instant a sync completes (from result.inserted).
  const [lastInserted, setLastInserted] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    xLastSyncStorage.getValue().then((v) => {
      if (!cancelled) setLastInserted(v?.inserted ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Immediate cooldown seed: `useCollectionLibrary` refreshes `lastSyncedAt`
  // from the DB after a sync, but we also seed the tick-source here so the
  // button locks the exact instant the sync resolves (no wait for meta refresh).
  const [syncedAtSeed, setSyncedAtSeed] = useState<number | null>(null);

  const syncFn = useCallback(async (onProgress: (progress: XSyncProgress) => void) => {
    // Auth is resolved HERE (app.html is a storage-capable trusted context);
    // syncBookmarks itself never touches storage — it also runs import-safe for
    // the offscreen document, which has no chrome.storage.
    const auth = await getXAuth();
    const result = await syncBookmarks(auth, (fetchedCount, page) => {
      onProgress({ fetchedCount, page });
    });
    // Auto-tag + auto-embed the tweets just persisted. Same storage-context
    // reasoning as auth: the tagging/embedding import chains need chrome.storage,
    // so the triggers live in this app.html caller.
    void tagNewItems('x', result.newItemIds);
    void embedNewItems('x', result.newItemIds);

    // Persist the "N new this run" summary + lock the cooldown immediately.
    const summary: XLastSync = { syncedAt: Date.now(), inserted: result.inserted };
    void xLastSyncStorage.setValue(summary);
    setLastInserted(result.inserted);
    setSyncedAtSeed(summary.syncedAt);
  }, []);

  const lib = useCollectionLibrary<XBookmarkItem, AuthorCount, XSyncProgress, XSyncError>({
    queryFn,
    facetsFn: getAuthorCounts,
    lastSyncedFn: getLastSyncedAt,
    syncFn,
    classifyError: classifyXSyncError,
    logTag: 'x-bookmarks',
  });

  // Cooldown source = the later of the DB last-synced time (survives reloads)
  // and the in-session seed (locks instantly on sync completion).
  const dbSyncedAt = lib.lastSyncedAt?.getTime() ?? null;
  const effectiveSyncedAt =
    dbSyncedAt !== null && syncedAtSeed !== null
      ? Math.max(dbSyncedAt, syncedAtSeed)
      : (dbSyncedAt ?? syncedAtSeed);

  // Tick every second while inside the cooldown window to drive the countdown.
  const [now, setNow] = useState(() => Date.now());
  const cooldownRemainingMs = remainingCooldown(effectiveSyncedAt, now);
  const inCooldown = cooldownRemainingMs > 0;
  useEffect(() => {
    if (!inCooldown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inCooldown, effectiveSyncedAt]);

  return {
    bookmarks: lib.items,
    total: lib.total,
    totalPages: lib.totalPages,
    loading: lib.loading,
    queryError: lib.queryError,
    retryQuery: lib.retryQuery,
    author: lib.filter,
    setAuthor: lib.setFilter,
    searchInput: lib.searchInput,
    setSearchInput: lib.setSearchInput,
    page: lib.page,
    goToPage: lib.goToPage,
    authors: lib.facets,
    libraryCount: lib.libraryCount,
    lastSyncedAt: lib.lastSyncedAt,
    metaLoading: lib.metaLoading,
    syncing: lib.syncing,
    syncProgress: lib.syncProgress,
    syncError: lib.syncError,
    sync: lib.sync,
    lastInserted,
    cooldownRemainingMs,
  };
}

// Re-exported for callers/tests that need the raw window length.
export { COOLDOWN_MS };
