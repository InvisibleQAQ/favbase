import { fetchAndSyncFolders, syncAllFavoriteVideos } from '@/lib/bilibili/bili-sync-service';
import { getBiliAuth } from '@/lib/bilibili/bilibili-api';
import { syncBookmarks as syncBrowserBookmarks } from '@/lib/bookmarks/bookmarks-sync-service';
import type { CooperativeCheckpoint } from '@/lib/collections';
import { getDb } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import { syncStars } from '@/lib/github/github-sync-service';
import { settingsStorage } from '@/lib/storage';
import { getXAuth } from '@/lib/x/x-auth';
import { syncBookmarks } from '@/lib/x/x-sync-service';
import { syncFavorites, ZhihuAuthError } from '@/lib/zhihu/zhihu-sync-service';
import { syncYoutubePlaylists } from '@/lib/youtube/youtube-sync-service';

import { remainingCooldown } from '../sections/x/cooldown';

/**
 * One platform's automatic-sync contract. The daily-auto-sync coordinator drives
 * every entry uniformly: gate on `sources.lastFetchedAt` (per-platform daily),
 * probe readiness live, then dispatch the sync through the shared `startJob`.
 *
 * `runSync` returns the newly-persisted item ids (empty => no auto-tag/embed).
 * Bookmarks and Bilibili persist content asynchronously (extraction /
 * transcription pipelines flip their own items), so they return `[]` here — the
 * batch enqueue is only for the sync-time-text platforms.
 */
export interface AutoSyncPlatform {
  /** startJob namespace key (e.g. 'github-stars'). Reuses the indicator's labels. */
  jobPlatform: string;
  /** DB platform discriminator (e.g. 'github'), for gate + processing enqueue. */
  itemPlatform: string;
  /** Live readiness probe — zero persistence. False => silently skipped. */
  probeReady(): Promise<boolean>;
  /** Run the sync; resolve with newItemIds (empty => no processing enqueue). */
  runSync(
    setProgress: (progress: unknown) => void,
    control: CooperativeCheckpoint,
  ): Promise<string[]>;
  /**
   * When true for a thrown error, treat it as "not ready / logged out": complete
   * the job silently instead of marking it failed (e.g. zhihu logged out).
   */
  isSilentError?(err: unknown): boolean;
}

export const AUTO_SYNC_PLATFORMS: AutoSyncPlatform[] = [
  {
    jobPlatform: 'github-stars',
    itemPlatform: 'github',
    probeReady: async () => Boolean((await settingsStorage.getValue()).githubToken),
    runSync: async (_setProgress, control) => {
      const token = (await settingsStorage.getValue()).githubToken;
      if (!token) return [];
      const r = await syncStars(token, undefined, undefined, control);
      return r.newItemIds;
    },
  },
  {
    jobPlatform: 'x-bookmarks',
    itemPlatform: 'x',
    probeReady: async () => {
      if ((await getXAuth()) === null) return false;
      // Honor the X-specific 5-minute cooldown across the day boundary: the daily
      // gate already blocks same-day re-sync, but a sync at 23:58 followed by a
      // next-day evaluation at 00:01 would otherwise fire inside the cooldown.
      const last = await getPlatformLastSyncedAt('x', getDb());
      return remainingCooldown(last ? last.getTime() : null, Date.now()) === 0;
    },
    runSync: async (_setProgress, control) => {
      const auth = await getXAuth();
      const r = await syncBookmarks(auth, undefined, control);
      return r.newItemIds;
    },
  },
  {
    jobPlatform: 'zhihu-favorites',
    itemPlatform: 'zhihu',
    probeReady: async () => true,
    runSync: async (_setProgress, control) => {
      const r = await syncFavorites(undefined, control);
      return r.newItemIds;
    },
    isSilentError: (err) => err instanceof ZhihuAuthError,
  },
  {
    jobPlatform: 'youtube-playlists',
    itemPlatform: 'youtube',
    probeReady: async () => {
      const s = await settingsStorage.getValue();
      return Boolean(s.youtubeApiKey && s.youtubeChannel);
    },
    runSync: async (_setProgress, control) => {
      const s = await settingsStorage.getValue();
      if (!s.youtubeApiKey || !s.youtubeChannel) return [];
      const r = await syncYoutubePlaylists(
        { apiKey: s.youtubeApiKey, channel: s.youtubeChannel },
        undefined,
        control,
      );
      return r.newItemIds;
    },
  },
  {
    jobPlatform: 'bookmarks',
    itemPlatform: 'bookmarks',
    // Local browser data — always ready.
    probeReady: async () => true,
    // Content extraction is a separate user-triggered pipeline; sync only writes
    // metadata (contentState='pending'), so nothing to enqueue here.
    runSync: async (_setProgress, control) => {
      await syncBrowserBookmarks(control);
      return [];
    },
  },
  {
    jobPlatform: 'bilibili',
    itemPlatform: 'bilibili',
    probeReady: async () => (await getBiliAuth()) !== null,
    // Transcription is an async post-sync pipeline (items stay 'pending' until
    // transcribed and enqueue themselves), so no batch enqueue here.
    runSync: async (setProgress, control) => {
      const folders = await fetchAndSyncFolders(control);
      await syncAllFavoriteVideos(folders, setProgress, control);
      return [];
    },
  },
];
