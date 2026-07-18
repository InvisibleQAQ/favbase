import { useCallback } from 'react';

import { useSettings } from '@/lib/hooks/useSettings';
import {
  syncYoutubePlaylists,
  getPlaylistVideos,
  getPlaylistCounts,
  getLastSyncedAt,
  YoutubeAuthError,
  YoutubeRateLimitError,
  type YoutubeVideoItem,
  type PlaylistCount,
  type YoutubePlaylistsProgress,
} from '@/lib/youtube/youtube-sync-service';

import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';

/**
 * Structured sync error — the view maps kinds to locale keys (i18n seam at the
 * UI boundary). 'auth' now means "the API key is invalid" (no OAuth grant to
 * expire anymore). Google sends no rate-limit reset header, so 'rate-limit'
 * carries no resetAt (quota resets at midnight Pacific).
 */
export type YoutubeSyncError =
  | { kind: 'auth' }
  | { kind: 'rate-limit' }
  | { kind: 'unknown'; message: string };

export function classifyYoutubeSyncError(err: unknown): YoutubeSyncError {
  if (err instanceof YoutubeAuthError) return { kind: 'auth' };
  if (err instanceof YoutubeRateLimitError) return { kind: 'rate-limit' };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

export interface UseYoutubePlaylistsReturn {
  // Paged query results (from PGlite via youtube-sync-service — no API reads)
  videos: YoutubeVideoItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;

  // Filters
  playlistId: string | null;
  setPlaylistId: (playlistId: string | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  page: number;
  goToPage: (page: number) => void;

  // Library meta (unfiltered)
  playlists: PlaylistCount[];
  libraryCount: number;
  lastSyncedAt: Date | null;
  metaLoading: boolean;

  // Config state (drives the full-page "not configured" empty state): API key
  // + channel both live in UserSettings — a single synchronous gate (the old
  // async authorization probe died with OAuth).
  hasConfig: boolean;
  settingsLoading: boolean;

  // One-shot full sync (manual button — never auto-on-mount: remote, quota'd
  // endpoint; playlist order is position order so there is no incremental cutoff)
  syncing: boolean;
  syncProgress: YoutubePlaylistsProgress | null;
  syncError: YoutubeSyncError | null;
  sync: () => Promise<void>;
}

function queryFn({ filter, search, page, pageSize }: CollectionQueryParams) {
  return getPlaylistVideos({
    playlistId: filter ?? undefined,
    search: search || undefined,
    page,
    pageSize,
  });
}

/** Thin adapter over the shared collection-library state machine. */
export function useYoutubePlaylists(): UseYoutubePlaylistsReturn {
  const { settings, loading: settingsLoading } = useSettings();
  const apiKey = settings.youtubeApiKey ?? '';
  const channel = settings.youtubeChannel ?? '';
  const hasConfig = Boolean(apiKey && channel);

  // Config resolution stays inside the adapter's syncFn closure (spec rule:
  // the generic layer reads zero storage / zero platform auth).
  const syncFn = useCallback(
    async (onProgress: (progress: YoutubePlaylistsProgress) => void) => {
      if (!apiKey || !channel) return;
      await syncYoutubePlaylists({ apiKey, channel }, onProgress);
    },
    [apiKey, channel],
  );

  const lib = useCollectionLibrary<
    YoutubeVideoItem,
    PlaylistCount,
    YoutubePlaylistsProgress,
    YoutubeSyncError
  >({
    queryFn,
    facetsFn: getPlaylistCounts,
    lastSyncedFn: getLastSyncedAt,
    syncFn,
    classifyError: classifyYoutubeSyncError,
    logTag: 'youtube-playlists',
  });

  const { sync: syncInner } = lib;

  // Config gate outside the generic sync: without config this is a silent
  // no-op (no syncing state flip) — github token-gate pattern.
  const sync = useCallback(async () => {
    if (!hasConfig) return;
    await syncInner();
  }, [hasConfig, syncInner]);

  return {
    videos: lib.items,
    total: lib.total,
    totalPages: lib.totalPages,
    loading: lib.loading,
    queryError: lib.queryError,
    retryQuery: lib.retryQuery,
    playlistId: lib.filter,
    setPlaylistId: lib.setFilter,
    searchInput: lib.searchInput,
    setSearchInput: lib.setSearchInput,
    page: lib.page,
    goToPage: lib.goToPage,
    playlists: lib.facets,
    libraryCount: lib.libraryCount,
    lastSyncedAt: lib.lastSyncedAt,
    metaLoading: lib.metaLoading,
    hasConfig,
    settingsLoading,
    syncing: lib.syncing,
    syncProgress: lib.syncProgress,
    syncError: lib.syncError,
    sync,
  };
}
