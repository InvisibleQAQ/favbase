import {
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
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { runZhihuFavoritesSync, type ZhihuSyncProgress } from './zhihu-sync-adapter';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'zhihu-favorites';

// Re-exported so consumers keep importing the progress type from the hook; the
// type + mapping live in the shared Sync Adapter (single trigger surface).
export type { ZhihuSyncProgress } from './zhihu-sync-adapter';

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
  syncJob: BackgroundJob<ZhihuSyncProgress> | null;
  sync: () => Promise<void>;

  // Post-sync embed / tag jobs (progress captions).
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
}

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getFavorites({
    collectionId: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
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
    // The shared Sync Adapter (module ref = stable): progress mapping and the
    // post-sync embed/tag dispatch live there — the daily auto-sync coordinator
    // runs the exact same function.
    syncFn: runZhihuFavoritesSync,
    classifyError: classifyZhihuSyncError,
    logTag: LOG_TAG,
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
    syncJob: lib.syncJob,
    sync: lib.sync,
    embedJob: lib.embedJob,
    tagJob: lib.tagJob,
  };
}
