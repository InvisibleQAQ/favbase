import { useEffect } from 'react';

import {
  getBookmarks,
  getFolders,
  getLastSyncedAt,
  type BookmarkItem,
  type BookmarkFolderRef,
} from '@/lib/bookmarks/bookmarks-sync-service';
import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { runBookmarksSync, type BookmarksSyncProgress } from './bookmarks-sync-adapter';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'bookmarks';

export interface UseBookmarksReturn {
  // Paged query results (from PGlite via bookmarks-sync-service)
  bookmarks: BookmarkItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Search + pagination (the folder filter is the route's, not the hook's)
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta
  folders: BookmarkFolderRef[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // Auto-sync (runs once on mount; `sync` re-exposed for error-state retry)
  syncing: boolean;
  syncError: string | null;
  syncJob: BackgroundJob | null;
  sync: () => Promise<void>;
}

/** `filter` is the route folder id; `null` (route "All") = whole library. */
function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getBookmarks({
    folderId: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

/** Local browser data throws plain errors — the view shows the message verbatim. */
function classifySyncError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Thin adapter over the shared collection-library state machine. Bookmarks'
 * only deviations from the flat remote pages live here: the folder filter is
 * CONTROLLED by the route (`/collections/bookmarks/:folderId`, undefined =
 * "All"), and the sync auto-runs on mount (local data is instant — no button
 * gate; the job store dedupes against the daily coordinator and the fetch
 * button, so a remount re-joins an in-flight run).
 */
export function useBookmarks(folderId: string | undefined): UseBookmarksReturn {
  const lib = useCollectionLibrary<
    BookmarkItem,
    BookmarkFolderRef,
    BookmarksSyncProgress,
    string
  >({
    queryFn,
    facetsFn: getFolders,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): tree sync, chained content
    // extraction and the backlog embed dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runBookmarksSync,
    classifyError: classifySyncError,
    logTag: LOG_TAG,
    controlledFilter: folderId ?? null,
  });

  const { sync } = lib;
  useEffect(() => {
    void sync();
  }, [sync]);

  return {
    bookmarks: lib.items,
    total: lib.total,
    totalPages: lib.totalPages,
    loading: lib.loading,
    queryError: lib.queryError,
    retryQuery: lib.retryQuery,
    searchInput: lib.searchInput,
    setSearchInput: lib.setSearchInput,
    page: lib.page,
    goToPage: lib.goToPage,
    folders: lib.facets,
    libraryCount: lib.libraryCount,
    lastSyncedAt: lib.lastSyncedAt,
    metaLoading: lib.metaLoading,
    syncing: lib.syncing,
    syncError: lib.syncError,
    syncJob: lib.syncJob,
    sync,
  };
}
