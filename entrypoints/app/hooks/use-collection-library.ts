import { useCallback, useEffect, useRef, useState } from 'react';

import { initDbProxy } from '@/lib/database';

const DEFAULT_PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

/** One page of rows from the platform's PGlite query function. */
export interface CollectionPage<TItem> {
  rows: TItem[];
  total: number;
}

/** Normalized params the generic hook passes to `queryFn`. */
export interface CollectionQueryParams {
  /** Single-dimension facet filter (language / author handle / collection id). */
  filter: string | null;
  /** Debounced, trimmed search text — '' means no search. */
  search: string;
  page: number;
  pageSize: number;
}

/**
 * Platform injection points. Every function MUST be referentially stable
 * (module-level constant or useCallback) — they sit in effect dependency
 * arrays, so an unstable reference re-runs queries every render.
 */
export interface UseCollectionLibraryConfig<TItem, TFacet, TProgress, TError> {
  /** Paged query against local PGlite (no remote reads). */
  queryFn: (params: CollectionQueryParams) => Promise<CollectionPage<TItem>>;
  /** Facet counts for the chips row (unfiltered). */
  facetsFn: () => Promise<TFacet[]>;
  /** Last successful sync time. */
  lastSyncedFn: () => Promise<Date | null>;
  /** One-shot remote sync. Auth resolution stays inside the platform closure. */
  syncFn: (onProgress: (progress: TProgress) => void) => Promise<void>;
  /** Maps thrown sync errors to the platform's structured error union. */
  classifyError: (err: unknown) => TError;
  /** console.error prefix, e.g. 'x-bookmarks'. */
  logTag: string;
  pageSize?: number;
}

export interface UseCollectionLibraryReturn<TItem, TFacet, TProgress, TError> {
  // Paged query results
  items: TItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Filters
  filter: string | null;
  setFilter: (filter: string | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta (unfiltered)
  facets: TFacet[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // One-shot sync (manual trigger — never auto-on-mount)
  syncing: boolean;
  syncProgress: TProgress | null;
  syncError: TError | null;
  sync: () => Promise<void>;
}

/**
 * Platform-neutral state machine for "single list + facet chips + manual sync"
 * collection pages (github / x / zhihu). Owns: search debounce, paged query
 * with cancellation, library meta refresh, and sync orchestration. Platform
 * adapters rename the generic fields back to their domain vocabulary.
 */
export function useCollectionLibrary<TItem, TFacet, TProgress, TError>(
  config: UseCollectionLibraryConfig<TItem, TFacet, TProgress, TError>,
): UseCollectionLibraryReturn<TItem, TFacet, TProgress, TError> {
  const { queryFn, facetsFn, lastSyncedFn, syncFn, classifyError, logTag } = config;
  const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;

  // Filters
  const [filter, setFilterState] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  // Paged query results
  const [items, setItems] = useState<TItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library meta
  const [facets, setFacets] = useState<TFacet[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<TProgress | null>(null);
  const [syncError, setSyncError] = useState<TError | null>(null);

  // Staleness guard for user-triggered async (sync) — no context id drifts on
  // these pages (single global source per platform), only unmount to protect
  // against.
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

  const setFilter = useCallback((next: string | null) => {
    setFilterState(next);
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
        const result = await queryFn({ filter, search, page, pageSize });
        if (cancelled) return;
        setItems(result.rows);
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
  }, [filter, search, page, queryVersion, queryFn, pageSize]);

  // Library meta: facet counts + last sync time + unfiltered total.
  const refreshMeta = useCallback(async () => {
    await initDbProxy();
    const [facetRows, syncedAt, countResult] = await Promise.all([
      facetsFn(),
      lastSyncedFn(),
      // Unfiltered total = library size (facet counts may exclude rows with a
      // null facet, so they cannot be summed as a substitute).
      queryFn({ filter: null, search: '', page: 1, pageSize: 1 }),
    ]);
    if (!mountedRef.current) return;
    setFacets(facetRows);
    setLastSyncedAt(syncedAt);
    setLibraryCount(countResult.total);
  }, [facetsFn, lastSyncedFn, queryFn]);

  useEffect(() => {
    (async () => {
      try {
        await refreshMeta();
      } catch (err) {
        console.error(`[${logTag}] meta load failed:`, err);
      } finally {
        if (mountedRef.current) setMetaLoading(false);
      }
    })();
  }, [refreshMeta, logTag]);

  const sync = useCallback(async () => {
    if (syncing) return;

    setSyncing(true);
    setSyncError(null);
    setSyncProgress(null);
    try {
      await initDbProxy();
      await syncFn((progress) => {
        if (!mountedRef.current) return;
        setSyncProgress(progress);
      });
      await refreshMeta();
      if (!mountedRef.current) return;
      setQueryVersion((v) => v + 1);
    } catch (err) {
      console.error(`[${logTag}] sync failed:`, err);
      if (!mountedRef.current) return;
      setSyncError(classifyError(err));
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
  }, [syncing, refreshMeta, syncFn, classifyError, logTag]);

  return {
    items,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    queryError,
    retryQuery,
    filter,
    setFilter,
    searchInput,
    setSearchInput,
    page,
    goToPage,
    facets,
    libraryCount,
    lastSyncedAt,
    metaLoading,
    syncing,
    syncProgress,
    syncError,
    sync,
  };
}
