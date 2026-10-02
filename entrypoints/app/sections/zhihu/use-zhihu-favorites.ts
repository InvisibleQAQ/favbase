import {
  getFavorites,
  getCollectionCounts,
  getLastSyncedAt,
  type ZhihuFavoriteItem,
  type ZhihuCollectionCount,
} from '@/lib/zhihu/zhihu-sync-service';
import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import type { CollectionSyncError } from '../../hooks/collection-sync-error';
import { runZhihuFavoritesSync, type ZhihuSyncProgress } from './zhihu-sync-adapter';

/**
 * Background-job namespace, derived from the domain Platform Descriptor's
 * `jobPlatform` — also this hook's `useCollectionLibrary` `logTag`.
 */
const JOB_PLATFORM = jobPlatformForCollection('zhihu');

// Re-exported so consumers keep importing the progress type from the hook; the
// type + mapping live in the shared Sync Adapter (single trigger surface).
export type { ZhihuSyncProgress } from './zhihu-sync-adapter';

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
  syncError: CollectionSyncError | null;
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
  const lib = useCollectionLibrary<ZhihuFavoriteItem, ZhihuCollectionCount, ZhihuSyncProgress>({
    queryFn,
    facetsFn: getCollectionCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): progress mapping and the
    // post-sync embed/tag dispatch live there — the daily auto-sync coordinator
    // runs the exact same function.
    syncFn: runZhihuFavoritesSync,
    logTag: JOB_PLATFORM,
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
