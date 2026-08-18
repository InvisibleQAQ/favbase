import { useCallback } from 'react';

import { useSettings } from '@/lib/hooks/useSettings';
import {
  getStarredRepos,
  getLanguageCounts,
  getLastSyncedAt,
  GithubAuthError,
  GithubRateLimitError,
  type GithubRepoItem,
  type LanguageCount,
} from '@/lib/github/github-sync-service';
import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { runGithubStarsSync, type SyncProgress } from './github-sync-adapter';

/** Job namespace key (reused as `useCollectionLibrary` logTag). */
const LOG_TAG = 'github-stars';

// Re-exported so the view keeps importing progress types from the hook; the
// types + mapping live in the shared Sync Adapter (single trigger surface).
export type { SyncProgress, StarsPhaseProgress, ReadmePhaseProgress } from './github-sync-adapter';

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
  syncJob: BackgroundJob<SyncProgress> | null;
  sync: () => Promise<void>;

  // Post-sync embed / tag jobs (progress captions).
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
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

  const lib = useCollectionLibrary<GithubRepoItem, LanguageCount, SyncProgress, GithubSyncError>({
    queryFn,
    facetsFn: getLanguageCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): token resolution, progress
    // mapping and the post-sync embed/tag dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runGithubStarsSync,
    classifyError: classifySyncError,
    logTag: LOG_TAG,
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
    syncJob: lib.syncJob,
    sync,
    embedJob: lib.embedJob,
    tagJob: lib.tagJob,
  };
}
