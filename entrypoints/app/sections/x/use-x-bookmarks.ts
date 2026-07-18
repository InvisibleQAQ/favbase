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

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';

// Re-exported so the view keeps importing XSyncError from the hook; the type +
// classifier live in lib/x (shared with the x.com content-script path).
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
}

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getBookmarks({
    author: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

async function syncFn(onProgress: (progress: XSyncProgress) => void) {
  // Auth is resolved HERE (app.html is a storage-capable trusted context);
  // syncBookmarks itself never touches storage — it also runs in the
  // offscreen document, which has no chrome.storage.
  const auth = await getXAuth();
  const result = await syncBookmarks(auth, (fetchedCount, page) => {
    onProgress({ fetchedCount, page });
  });
  // Auto-tag the tweets just persisted (audit docs/16 MEDIUM-2). Same
  // storage-context reasoning as auth: the tagging import chain needs
  // chrome.storage, so the trigger lives in this app.html caller — the
  // offscreen float-button path does not auto-tag (recorded debt).
  void tagNewItems('x', result.newItemIds);
}

/** Thin adapter over the shared collection-library state machine. */
export function useXBookmarks(): UseXBookmarksReturn {
  const lib = useCollectionLibrary<XBookmarkItem, AuthorCount, XSyncProgress, XSyncError>({
    queryFn,
    facetsFn: getAuthorCounts,
    lastSyncedFn: getLastSyncedAt,
    syncFn,
    classifyError: classifyXSyncError,
    logTag: 'x-bookmarks',
  });

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
  };
}
