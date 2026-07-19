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
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import { startJob, type BackgroundJob } from '../../hooks/background-jobs-store';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'zhihu-favorites';
/** DB platform discriminator for tag/embed (distinct from the UI job key). */
const PLATFORM = 'zhihu';

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

async function syncFn(onProgress: (progress: ZhihuSyncProgress) => void) {
  // Auth is the browser's own zhihu cookie jar (credentials:'include' +
  // host permission) — nothing to resolve here; a logged-out session
  // surfaces as ZhihuAuthError from the fetch layer.
  const result = await syncFavorites((fetchedCount, current, totalCollections) => {
    onProgress({ fetchedCount, current, total: totalCollections });
  });
  // Auto-tag + auto-embed the content just persisted, registered as background
  // jobs (survive route switches, cross-mount dedupe, feed the global "don't
  // close" reminder, done/total captions). Moved UP from the lib wrapper (ST3)
  // so all four collection platforms share this single hook-layer seam; the
  // store is a module singleton, so a module-level function can call startJob.
  startJob(LOG_TAG, 'tag', (sp) => tagNewItems(PLATFORM, result.newItemIds, undefined, (p) => sp(p)));
  startJob(LOG_TAG, 'embed', (sp) =>
    embedNewItems(PLATFORM, result.newItemIds, undefined, (p) => sp(p)),
  );
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
    sync: lib.sync,
    embedJob: lib.embedJob,
    tagJob: lib.tagJob,
  };
}
