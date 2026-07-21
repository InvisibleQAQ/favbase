import { useCallback, useEffect, useRef, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import {
  syncBookmarks,
  getBookmarks,
  getFolders,
  getLastSyncedAt,
  type BookmarkItem,
  type BookmarkFolderRef,
} from '@/lib/bookmarks/bookmarks-sync-service';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface UseBookmarksReturn {
  // Paged query results (from PGlite via bookmarks-sync-service)
  bookmarks: BookmarkItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Search + pagination
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
  sync: () => void;
}

/**
 * Owns the bookmarks page data: auto-syncs the local bookmark tree into PGlite
 * on mount (mirrors bilibili's fetchAndSync-on-mount), then serves a paged,
 * folder-scoped, searchable query. `folderId` (from the route) narrows the
 * query; undefined = whole library ("All").
 */
export function useBookmarks(folderId: string | undefined): UseBookmarksReturn {
  // Query state
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library meta
  const [folders, setFolders] = useState<BookmarkFolderRef[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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

  // Changing folder resets to page 1 (no double-query: search unchanged).
  useEffect(() => {
    setPage(1);
  }, [folderId]);

  const goToPage = useCallback((p: number) => setPage(p), []);
  const retryQuery = useCallback(() => setQueryVersion((v) => v + 1), []);

  const refreshMeta = useCallback(async () => {
    await initDbProxy();
    const [fs, syncedAt, countResult] = await Promise.all([
      getFolders(),
      getLastSyncedAt(),
      // Unfiltered total = library size — drives the empty-state decision.
      getBookmarks({ page: 1, pageSize: 1 }),
    ]);
    if (!mountedRef.current) return;
    setFolders(fs);
    setLastSyncedAt(syncedAt);
    setLibraryCount(countResult.total);
  }, []);

  // One-shot re-scan of the local bookmark tree. Stable identity (refreshMeta is
  // stable) so the mount effect runs it exactly once; also wired to the
  // error-state retry button.
  const runningRef = useRef(false);
  const sync = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await initDbProxy();
      await syncBookmarks();
    } catch (err) {
      console.error('[bookmarks] sync failed:', err);
      if (mountedRef.current) {
        setSyncError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
    try {
      await refreshMeta();
    } catch (err) {
      console.error('[bookmarks] meta load failed:', err);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) {
        setMetaLoading(false);
        setQueryVersion((v) => v + 1);
      }
    }
  }, [refreshMeta]);

  useEffect(() => {
    void sync();
  }, [sync]);

  // Paged query — refetch on folder/search/page change and after sync.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQueryError(null);

    (async () => {
      try {
        await initDbProxy();
        const result = await getBookmarks({
          folderId,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        setBookmarks(result.rows);
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
  }, [folderId, search, page, queryVersion]);

  return {
    bookmarks,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    queryError,
    retryQuery,
    searchInput,
    setSearchInput,
    page,
    goToPage,
    folders,
    libraryCount,
    lastSyncedAt,
    metaLoading,
    syncing,
    syncError,
    sync: () => {
      void sync();
    },
  };
}
