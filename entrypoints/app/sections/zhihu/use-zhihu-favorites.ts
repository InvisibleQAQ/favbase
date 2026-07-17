import {
  syncFavorites,
  getFavorites,
  getCollectionCounts,
  getLastSyncedAt,
  ZhihuAuthError,
  ZhihuRateLimitError,
  type ZhihuFavoriteItem,
  type ZhihuCollectionCount,
} from '@/lib/zhihu/zhihu-sync-service';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';

/**
 * Structured sync error — the view maps kinds to locale keys (i18n seam at the
 * UI boundary). Zhihu exposes no rate-limit reset header, so 'rate-limit'
 * carries no resetAt.
 */
export type ZhihuSyncError =
  | { kind: 'auth' }
  | { kind: 'rate-limit' }
  | { kind: 'unknown'; message: string };

export function classifyZhihuSyncError(err: unknown): ZhihuSyncError {
  if (err instanceof ZhihuAuthError) return { kind: 'auth' };
  if (err instanceof ZhihuRateLimitError) return { kind: 'rate-limit' };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

/** Progress for the zhihu sync — collection cursor + cumulative fetched count.
 *  The bar stays indeterminate (per-collection item totals are lazy). */
export interface ZhihuSyncProgress {
  fetchedCount: number;
  /** 1-based index of the collection currently being fetched. */
  current: number;
  /** Total public collections. */
  total: number;
}

export interface UseZhihuFavoritesReturn {
  // Paged query results (from PGlite via zhihu-sync-service — no API reads)
  favorites: ZhihuFavoriteItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Filters
  collectionId: string | null;
  setCollectionId: (collectionId: string | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta (unfiltered)
  collections: ZhihuCollectionCount[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // One-shot favorites sync (manual button — never auto-on-mount: remote,
  // rate-limited endpoint)
  syncing: boolean;
  syncProgress: ZhihuSyncProgress | null;
  syncError: ZhihuSyncError | null;
  sync: () => Promise<void>;
}

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getFavorites({
    collectionId: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

async function syncFn(onProgress: (progress: ZhihuSyncProgress) => void) {
  // Auth is the browser's own zhihu cookie jar (credentials:'include' +
  // host permission) — nothing to resolve here; a logged-out session
  // surfaces as ZhihuAuthError from the fetch layer.
  await syncFavorites((fetchedCount, current, totalCollections) => {
    onProgress({ fetchedCount, current, total: totalCollections });
  });
}

/** Thin adapter over the shared collection-library state machine. */
export function useZhihuFavorites(): UseZhihuFavoritesReturn {
  const lib = useCollectionLibrary<
    ZhihuFavoriteItem,
    ZhihuCollectionCount,
    ZhihuSyncProgress,
    ZhihuSyncError
  >({
    queryFn,
    facetsFn: getCollectionCounts,
    lastSyncedFn: getLastSyncedAt,
    syncFn,
    classifyError: classifyZhihuSyncError,
    logTag: 'zhihu-favorites',
  });

  return {
    favorites: lib.items,
    total: lib.total,
    totalPages: lib.totalPages,
    loading: lib.loading,
    queryError: lib.queryError,
    retryQuery: lib.retryQuery,
    collectionId: lib.filter,
    setCollectionId: lib.setFilter,
    searchInput: lib.searchInput,
    setSearchInput: lib.setSearchInput,
    page: lib.page,
    goToPage: lib.goToPage,
    collections: lib.facets,
    libraryCount: lib.libraryCount,
    lastSyncedAt: lib.lastSyncedAt,
    metaLoading: lib.metaLoading,
    syncing: lib.syncing,
    syncProgress: lib.syncProgress,
    syncError: lib.syncError,
    sync: lib.sync,
  };
}
