import { useCallback, useEffect, useRef, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import {
  syncBookmarks,
  getBookmarks,
  getAuthorCounts,
  getLastSyncedAt,
  XAuthError,
  XRateLimitError,
  type XBookmarkItem,
  type AuthorCount,
} from '@/lib/x/x-sync-service';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

/** Progress for the (cursor-paginated) X sync — total is unknowable, so this is
 *  always indeterminate; we surface the running fetched count + page number. */
export interface XSyncProgress {
  fetchedCount: number;
  page: number;
}

/** Structured sync error — the view maps kinds to locale keys (i18n seam at UI). */
export type XSyncError =
  | { kind: 'auth' }
  | { kind: 'rate-limit'; resetAt: Date | null }
  | { kind: 'unknown'; message: string };

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

function classifySyncError(err: unknown): XSyncError {
  if (err instanceof XAuthError) return { kind: 'auth' };
  if (err instanceof XRateLimitError) return { kind: 'rate-limit', resetAt: err.resetAt };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

export function useXBookmarks(): UseXBookmarksReturn {
  // Filters
  const [author, setAuthorState] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  // Paged query results
  const [bookmarks, setBookmarks] = useState<XBookmarkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library meta
  const [authors, setAuthors] = useState<AuthorCount[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<XSyncProgress | null>(null);
  const [syncError, setSyncError] = useState<XSyncError | null>(null);

  // Staleness guard for user-triggered async (sync) — no context id drifts on
  // this page (single global bookmarks source), only unmount to protect against.
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

  const setAuthor = useCallback((handle: string | null) => {
    setAuthorState(handle);
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
        const result = await getBookmarks({
          author: author ?? undefined,
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
  }, [author, search, page, queryVersion]);

  // Library meta: author counts + last sync time + unfiltered total.
  const refreshMeta = useCallback(async () => {
    await initDbProxy();
    const [authorRows, syncedAt, countResult] = await Promise.all([
      getAuthorCounts(),
      getLastSyncedAt(),
      // Unfiltered total = library size.
      getBookmarks({ page: 1, pageSize: 1 }),
    ]);
    if (!mountedRef.current) return;
    setAuthors(authorRows);
    setLastSyncedAt(syncedAt);
    setLibraryCount(countResult.total);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshMeta();
      } catch (err) {
        console.error('[x-bookmarks] meta load failed:', err);
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
      await syncBookmarks((fetchedCount, pg) => {
        if (!mountedRef.current) return;
        setSyncProgress({ fetchedCount, page: pg });
      });
      await refreshMeta();
      if (!mountedRef.current) return;
      setQueryVersion((v) => v + 1);
    } catch (err) {
      console.error('[x-bookmarks] sync failed:', err);
      if (!mountedRef.current) return;
      setSyncError(classifySyncError(err));
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
  }, [syncing, refreshMeta]);

  return {
    bookmarks,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    queryError,
    retryQuery,
    author,
    setAuthor,
    searchInput,
    setSearchInput,
    page,
    goToPage,
    authors,
    libraryCount,
    lastSyncedAt,
    metaLoading,
    syncing,
    syncProgress,
    syncError,
    sync,
  };
}
