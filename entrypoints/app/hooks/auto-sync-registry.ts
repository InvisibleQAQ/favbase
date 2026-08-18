import { getBiliAuth } from '@/lib/bilibili/bilibili-api';
import type { CooperativeCheckpoint } from '@/lib/collections';
import { getDb } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import { settingsStorage } from '@/lib/storage';
import { getXAuth } from '@/lib/x/x-auth';
import { ZhihuAuthError } from '@/lib/zhihu/zhihu-sync-service';

import { runBilibiliSync } from '../sections/bilibili/bilibili-sync-adapter';
import { runBookmarksSync } from '../sections/bookmarks/bookmarks-sync-adapter';
import { runGithubStarsSync } from '../sections/github-stars/github-sync-adapter';
import { remainingCooldown } from '../sections/x/cooldown';
import { runXBookmarksSync } from '../sections/x/x-sync-adapter';
import { runYoutubePlaylistsSync } from '../sections/youtube/youtube-sync-adapter';
import { runZhihuFavoritesSync } from '../sections/zhihu/zhihu-sync-adapter';

/**
 * One platform's automatic-sync trigger policy. The daily-auto-sync coordinator
 * drives every entry uniformly: gate on `sources.lastFetchedAt` (per-platform
 * daily), probe readiness live, then dispatch the sync through the shared
 * `startJob`.
 *
 * `runSync` is the platform's shared Sync Adapter — the SAME function the
 * manual collection page runs. It owns auth/config resolution, the domain sync
 * with typed progress, platform persistence side effects, and the post-sync
 * processing dispatch; this registry only adds trigger policy around it.
 */
export interface AutoSyncPlatform {
  /** startJob namespace key (e.g. 'github-stars'). Reuses the indicator's labels. */
  jobPlatform: string;
  /** DB platform discriminator (e.g. 'github'), for the daily gate query. */
  itemPlatform: string;
  /** Live readiness probe — zero persistence. False => silently skipped. */
  probeReady(): Promise<boolean>;
  /** The platform's shared Sync Adapter (missing auth/config is a silent no-op). */
  runSync(
    setProgress: (progress: unknown) => void,
    control: CooperativeCheckpoint,
  ): Promise<void>;
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
    runSync: runGithubStarsSync,
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
    runSync: runXBookmarksSync,
  },
  {
    jobPlatform: 'zhihu-favorites',
    itemPlatform: 'zhihu',
    probeReady: async () => true,
    runSync: runZhihuFavoritesSync,
    isSilentError: (err) => err instanceof ZhihuAuthError,
  },
  {
    jobPlatform: 'youtube-playlists',
    itemPlatform: 'youtube',
    probeReady: async () => {
      const s = await settingsStorage.getValue();
      return Boolean(s.youtubeApiKey && s.youtubeChannel);
    },
    runSync: runYoutubePlaylistsSync,
  },
  {
    jobPlatform: 'bookmarks',
    itemPlatform: 'bookmarks',
    // Local browser data — always ready.
    probeReady: async () => true,
    runSync: runBookmarksSync,
  },
  {
    jobPlatform: 'bilibili',
    itemPlatform: 'bilibili',
    probeReady: async () => (await getBiliAuth()) !== null,
    // No preferFolderId: the API's natural Source order runs.
    runSync: runBilibiliSync,
  },
];
