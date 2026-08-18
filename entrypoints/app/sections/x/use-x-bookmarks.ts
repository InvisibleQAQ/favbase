import { useEffect, useState } from 'react';

import {
  getBookmarks,
  getAuthorCounts,
  getLastSyncedAt,
  type XBookmarkItem,
  type AuthorCount,
} from '@/lib/x/x-sync-service';
import { classifyXSyncError, type XSyncError } from '@/lib/x/x-messages';
import { xLastSyncStorage, type XLastSync } from '@/lib/storage';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { COOLDOWN_MS, remainingCooldown } from './cooldown';
import { runXBookmarksSync, type XSyncProgress } from './x-sync-adapter';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'x-bookmarks';

// Re-exported so the view keeps importing XSyncError from the hook; the type +
// classifier live in lib/x (shared classifier; single trigger surface now).
export type { XSyncError };

// Re-exported so consumers keep importing the progress type from the hook; the
// type + mapping live in the shared Sync Adapter (single trigger surface).
export type { XSyncProgress } from './x-sync-adapter';

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
  syncJob: BackgroundJob<XSyncProgress> | null;
  sync: () => Promise<void>;

  // Post-sync embed / tag jobs (progress captions).
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;

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
  // Last-sync summary ("N new this run" + cooldown anchor) — the shared Sync
  // Adapter persists it on every successful sync (manual AND daily auto), so
  // the hook subscribes to the storage item instead of seeding it itself: an
  // auto-sync finishing while this page is mounted refreshes the caption and
  // locks the cooldown just like a manual one.
  const [lastSync, setLastSync] = useState<XLastSync | null>(null);
  useEffect(() => {
    let cancelled = false;
    xLastSyncStorage.getValue().then((v) => {
      if (!cancelled) setLastSync(v ?? null);
    });
    const unwatch = xLastSyncStorage.watch((v) => setLastSync(v ?? null));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);
  const lastInserted = lastSync?.inserted ?? null;
  const syncedAtSeed = lastSync?.syncedAt ?? null;

  const lib = useCollectionLibrary<XBookmarkItem, AuthorCount, XSyncProgress, XSyncError>({
    queryFn,
    facetsFn: getAuthorCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): auth resolution, progress
    // mapping, the post-sync embed/tag dispatch and the last-sync summary all
    // live there — the daily auto-sync coordinator runs the exact same function.
    syncFn: runXBookmarksSync,
    classifyError: classifyXSyncError,
    logTag: LOG_TAG,
  });

  // Cooldown source = the later of the DB last-synced time (survives reloads)
  // and the storage summary (lands the instant the sync resolves).
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
    syncJob: lib.syncJob,
    sync: lib.sync,
    embedJob: lib.embedJob,
    tagJob: lib.tagJob,
    lastInserted,
    cooldownRemainingMs,
  };
}

// Re-exported for callers/tests that need the raw window length.
export { COOLDOWN_MS };
