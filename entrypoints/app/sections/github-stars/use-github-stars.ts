import { useCallback, useEffect, useRef, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { useSettings } from '@/lib/hooks/useSettings';
import {
  syncStars,
  getStarredRepos,
  getLanguageCounts,
  getLastSyncedAt,
  GithubAuthError,
  GithubRateLimitError,
  type GithubRepoItem,
  type LanguageCount,
} from '@/lib/github/github-sync-service';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface SyncProgress {
  page: number;
  totalPages: number;
  fetchedCount: number;
  /** totalPages × average page size — exact once the last page lands. */
  estimatedTotal: number;
}

/** Structured sync error — the view maps kinds to locale keys (i18n seam at UI). */
export type GithubSyncError =
  | { kind: 'auth' }
  | { kind: 'rate-limit'; resetAt: Date | null }
  | { kind: 'unknown'; message: string };

export interface UseGithubStarsReturn {
  // Paged query results (from PGlite via github-sync-service — no API reads)
  repos: GithubRepoItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Filters
  language: string | null;
  setLanguage: (language: string | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta (unfiltered)
  languages: LanguageCount[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // Token presence (drives the "not connected" empty state)
  hasToken: boolean;
  settingsLoading: boolean;

  // One-shot full sync
  syncing: boolean;
  syncProgress: SyncProgress | null;
  syncError: GithubSyncError | null;
  sync: () => Promise<void>;
}

function classifySyncError(err: unknown): GithubSyncError {
  if (err instanceof GithubAuthError) return { kind: 'auth' };
  if (err instanceof GithubRateLimitError) return { kind: 'rate-limit', resetAt: err.resetAt };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

export function useGithubStars(): UseGithubStarsReturn {
  const { settings, loading: settingsLoading } = useSettings();
  const hasToken = Boolean(settings.githubToken);

  // Filters
  const [language, setLanguageState] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  // Paged query results
  const [repos, setRepos] = useState<GithubRepoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library meta
  const [languages, setLanguages] = useState<LanguageCount[]>([]);
  const [libraryCount, setLibraryCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncError, setSyncError] = useState<GithubSyncError | null>(null);

  // Staleness guard for user-triggered async (sync) — no context id drifts on
  // this page (single global stars source), only unmount to protect against.
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

  const setLanguage = useCallback((lang: string | null) => {
    setLanguageState(lang);
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
        const result = await getStarredRepos({
          language: language ?? undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        setRepos(result.rows);
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
  }, [language, search, page, queryVersion]);

  // Library meta: language counts + last sync time + unfiltered total.
  const refreshMeta = useCallback(async () => {
    await initDbProxy();
    const [langs, syncedAt, countResult] = await Promise.all([
      getLanguageCounts(),
      getLastSyncedAt(),
      // Unfiltered total = library size (includes repos with null language,
      // which getLanguageCounts excludes).
      getStarredRepos({ page: 1, pageSize: 1 }),
    ]);
    if (!mountedRef.current) return;
    setLanguages(langs);
    setLastSyncedAt(syncedAt);
    setLibraryCount(countResult.total);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshMeta();
      } catch (err) {
        console.error('[github-stars] meta load failed:', err);
      } finally {
        if (mountedRef.current) setMetaLoading(false);
      }
    })();
  }, [refreshMeta]);

  const sync = useCallback(async () => {
    const token = settings.githubToken;
    if (!token || syncing) return;

    setSyncing(true);
    setSyncError(null);
    setSyncProgress(null);
    try {
      await initDbProxy();
      await syncStars(token, (pg, totalPages, fetchedCount) => {
        if (!mountedRef.current) return;
        setSyncProgress({
          page: pg,
          totalPages,
          fetchedCount,
          estimatedTotal: Math.round((fetchedCount / pg) * totalPages),
        });
      });
      await refreshMeta();
      if (!mountedRef.current) return;
      setQueryVersion((v) => v + 1);
    } catch (err) {
      console.error('[github-stars] sync failed:', err);
      if (!mountedRef.current) return;
      setSyncError(classifySyncError(err));
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
  }, [settings.githubToken, syncing, refreshMeta]);

  return {
    repos,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    queryError,
    retryQuery,
    language,
    setLanguage,
    searchInput,
    setSearchInput,
    page,
    goToPage,
    languages,
    libraryCount,
    lastSyncedAt,
    metaLoading,
    hasToken,
    settingsLoading,
    syncing,
    syncProgress,
    syncError,
    sync,
  };
}
