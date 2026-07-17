import { useCallback, useEffect, useRef, useState } from 'react';

import { initDbProxy } from '@/lib/database';
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

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

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

export function useZhihuFavorites(): UseZhihuFavoritesReturn {
  // Filters
  const [collectionId, setCollectionIdState] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  // Paged query results
  const [favorites, setFavorites] = useState<ZhihuFavoriteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library meta
  const [collections, setCollections] = useState<ZhihuCollectionCount[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<ZhihuSyncProgress | null>(null);
  const [syncError, setSyncError] = useState<ZhihuSyncError | null>(null);

  // Staleness guard for user-triggered async (sync) — only unmount to protect
  // against on this page.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Debounce search input; reset to page 1 only on an actual value change.
  const searchRef = useRef('');
  useEffect(() => {
    const id = setTimeout(() => {
      const next = searchInput.trim();
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const setCollectionId = useCallback((id: string | null) => {
    setCollectionIdState(id);
    setPage(1);
  }, []);

  const goToPage = useCallback((p: number) => setPage(p), []);
  const retryQuery = useCallback(() => setQueryVersion((v) => v + 1), []);

  // Paged query — refetch on filter/page change and after sync (queryVersion).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQueryError(null);

    (async () => {
      try {
        await initDbProxy();
        const result = await getFavorites({
          collectionId: collectionId ?? undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        setFavorites(result.rows);
        setTotal(result.total);
      } catch (err) {
        if (cancelled) return;
        setQueryError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collectionId, search, page, queryVersion]);

  // Library meta: collection counts + last sync time + unfiltered total.
  const refreshMeta = useCallback(async () => {
    await initDbProxy();
    const [collectionRows, syncedAt, countResult] = await Promise.all([
      getCollectionCounts(),
      getLastSyncedAt(),
      // Unfiltered total = library size.
      getFavorites({ page: 1, pageSize: 1 }),
    ]);
    if (!mountedRef.current) return;
    setCollections(collectionRows);
    setLastSyncedAt(syncedAt);
    setLibraryCount(countResult.total);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshMeta();
      } catch (err) {
        console.error('[zhihu-favorites] meta load failed:', err);
      } finally {
        if (mountedRef.current) setMetaLoading(false);
      }
    })();
  }, [refreshMeta]);

  const sync = useCallback(async () => {
    if (syncing) return;

    setSyncing(true);
    setSyncError(null);
    setSyncProgress(null);
    try {
      await initDbProxy();
      // Auth is the browser's own zhihu cookie jar (credentials:'include' +
      // host permission) — nothing to resolve here; a logged-out session
      // surfaces as ZhihuAuthError from the fetch layer.
      await syncFavorites((fetchedCount, current, totalCollections) => {
        if (!mountedRef.current) return;
        setSyncProgress({ fetchedCount, current, total: totalCollections });
      });
      await refreshMeta();
      if (!mountedRef.current) return;
      setQueryVersion((v) => v + 1);
    } catch (err) {
      console.error('[zhihu-favorites] sync failed:', err);
      if (!mountedRef.current) return;
      setSyncError(classifyZhihuSyncError(err));
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
  }, [syncing, refreshMeta]);

  return {
    favorites,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    queryError,
    retryQuery,
    collectionId,
    setCollectionId,
    searchInput,
    setSearchInput,
    page,
    goToPage,
    collections,
    libraryCount,
    lastSyncedAt,
    metaLoading,
    syncing,
    syncProgress,
    syncError,
    sync,
  };
}
