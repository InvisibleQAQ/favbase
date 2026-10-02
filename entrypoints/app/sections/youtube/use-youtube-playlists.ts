import { useCallback } from 'react';

import { useSettings } from '@/lib/hooks/useSettings';
import {
  getPlaylistVideos,
  getPlaylistCounts,
  getLastSyncedAt,
  type YoutubeVideoItem,
  type PlaylistCount,
  type YoutubePlaylistsProgress,
} from '@/lib/youtube/youtube-sync-service';
import {
  useCollectionLibrary,
  type CollectionQueryParams,
} from '../../hooks/use-collection-library';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import type { CollectionSyncError } from '../../hooks/collection-sync-error';
import { runYoutubePlaylistsSync } from './youtube-sync-adapter';

/**
 * Background-job namespace, derived from the domain Platform Descriptor's
 * `jobPlatform` — also this hook's `useCollectionLibrary` `logTag`.
 */
const JOB_PLATFORM = jobPlatformForCollection('youtube');

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
  syncError: CollectionSyncError | null;
  syncJob: BackgroundJob<YoutubePlaylistsProgress> | null;
  sync: () => Promise<void>;

  // Post-sync embed / tag jobs (progress captions).
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
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

  const lib = useCollectionLibrary<YoutubeVideoItem, PlaylistCount, YoutubePlaylistsProgress>({
    queryFn,
    facetsFn: getPlaylistCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): config resolution, progress
    // mapping and the post-sync embed/tag dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runYoutubePlaylistsSync,
    logTag: JOB_PLATFORM,
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
    syncJob: lib.syncJob,
    sync,
    embedJob: lib.embedJob,
    tagJob: lib.tagJob,
  };
}
