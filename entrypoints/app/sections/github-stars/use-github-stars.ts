import { useCallback } from 'react';

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
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';

/** Phase 1: paged star-list fetch (determinate once the Link header lands). */
export interface StarsPhaseProgress {
  phase: 'stars';
  page: number;
  totalPages: number;
  fetchedCount: number;
  /** totalPages × average page size — exact once the last page lands. */
  estimatedTotal: number;
}

/** Phase 2: serial README fetch for NEW repos only (diffed against the DB). */
export interface ReadmePhaseProgress {
  phase: 'readme';
  done: number;
  total: number;
}

export type SyncProgress = StarsPhaseProgress | ReadmePhaseProgress;

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

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getStarredRepos({
    language: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

/** Thin adapter over the shared collection-library state machine. */
export function useGithubStars(): UseGithubStarsReturn {
  const { settings, loading: settingsLoading } = useSettings();
  const token = settings.githubToken;
  const hasToken = Boolean(token);

  const syncFn = useCallback(
    async (onProgress: (progress: SyncProgress) => void) => {
      if (!token) return;
      const result = await syncStars(
        token,
        (page, totalPages, fetchedCount) => {
          onProgress({
            phase: 'stars',
            page,
            totalPages,
            fetchedCount,
            estimatedTotal: Math.round((fetchedCount / page) * totalPages),
          });
        },
        (done, total) => {
          onProgress({ phase: 'readme', done, total });
        },
      );
      // Auto-tag + auto-embed the READMEs just persisted. The triggers live in
      // this app.html caller (not in lib/github) — the tagging/embedding import
      // chains need chrome.storage, and lib/github stays storage-free.
      void tagNewItems('github', result.newItemIds);
      void embedNewItems('github', result.newItemIds);
    },
    [token],
  );

  const lib = useCollectionLibrary<GithubRepoItem, LanguageCount, SyncProgress, GithubSyncError>({
    queryFn,
    facetsFn: getLanguageCounts,
    lastSyncedFn: getLastSyncedAt,
    syncFn,
    classifyError: classifySyncError,
    logTag: 'github-stars',
  });

  const { sync: syncInner } = lib;

  // Token gate outside the generic sync: without a token this is a silent
  // no-op (no syncing state flip), matching the pre-extraction behavior.
  const sync = useCallback(async () => {
    if (!token) return;
    await syncInner();
  }, [token, syncInner]);

  return {
    repos: lib.items,
    total: lib.total,
    totalPages: lib.totalPages,
    loading: lib.loading,
    queryError: lib.queryError,
    retryQuery: lib.retryQuery,
    language: lib.filter,
    setLanguage: lib.setFilter,
    searchInput: lib.searchInput,
    setSearchInput: lib.setSearchInput,
    page: lib.page,
    goToPage: lib.goToPage,
    languages: lib.facets,
    libraryCount: lib.libraryCount,
    lastSyncedAt: lib.lastSyncedAt,
    metaLoading: lib.metaLoading,
    hasToken,
    settingsLoading,
    syncing: lib.syncing,
    syncProgress: lib.syncProgress,
    syncError: lib.syncError,
    sync,
  };
}
