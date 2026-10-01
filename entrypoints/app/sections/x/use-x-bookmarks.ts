import { useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { getPlatformSyncRecord } from '@/lib/database/platform-sync-record';
import {
  getBookmarks,
  getAuthorCounts,
  getLastSyncedAt,
  type XBookmarkItem,
  type AuthorCount,
} from '@/lib/x/x-sync-service';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import type { CollectionSyncError } from '../../hooks/collection-sync-error';
import { useCountdown } from '../../hooks/use-countdown';
import { remainingCooldown } from './cooldown';
import { runXBookmarksSync, type XSyncProgress } from './x-sync-adapter';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'x-bookmarks';

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
  syncError: CollectionSyncError | null;
  syncJob: BackgroundJob<XSyncProgress> | null;
  sync: () => Promise<void>;

  // Post-sync embed / tag jobs (progress captions).
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;

  // X-specific: last-sync "N new this run" (Platform Sync Record) + sync cooldown.
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
  const lib = useCollectionLibrary<XBookmarkItem, AuthorCount, XSyncProgress>({
    queryFn,
    facetsFn: getAuthorCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): auth resolution, progress
    // mapping and — through the Platform Sync funnel — the post-sync embed/tag
    // dispatch and the Platform Sync Record all live there; the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runXBookmarksSync,
    logTag: LOG_TAG,
  });

  // "N new this run" = the Platform Sync Record's `lastInserted`, written with
  // the success that `lib.lastSyncedAt` reads. Re-read whenever the sync job's
  // generation moves — it only moves on success, exactly when the count does —
  // so an auto-sync finishing while this page is mounted refreshes the caption
  // just like a manual one.
  const syncGeneration = lib.syncJob?.generation ?? 0;
  const [lastInserted, setLastInserted] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = await getPlatformSyncRecord('x', await initDbProxy());
      if (!cancelled) setLastInserted(record?.lastInserted ?? null);
    })().catch((err) => console.error(`[${LOG_TAG}] sync record load failed:`, err));
    return () => {
      cancelled = true;
    };
  }, [syncGeneration]);

  // Cooldown anchor = the latest successful sync (Platform Sync Record, survives
  // reloads; a failed sync never moves it, so it never locks the button).
  const effectiveSyncedAt = lib.lastSyncedAt?.getTime() ?? null;

  // The shared 1 s countdown ticks while inside the cooldown window.
  const cooldownRemainingMs = useCountdown((now) => remainingCooldown(effectiveSyncedAt, now));

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
