import type { CollectionPlatform } from '@/lib/collections/platforms';

import { jobPlatformForCollection } from './hooks/collection-job-platform';
import type { AutoSyncDefinition, AutoSyncPlatform } from './hooks/use-daily-auto-sync';
import { bilibiliAutoSyncPolicy, runBilibiliSync } from './sections/bilibili/bilibili-sync-adapter';
import { bookmarksAutoSyncPolicy, runBookmarksSync } from './sections/bookmarks/bookmarks-sync-adapter';
import { githubAutoSyncPolicy, runGithubStarsSync } from './sections/github-stars/github-sync-adapter';
import { runXBookmarksSync, xAutoSyncPolicy } from './sections/x/x-sync-adapter';
import { runYoutubePlaylistsSync, youtubeAutoSyncPolicy } from './sections/youtube/youtube-sync-adapter';
import { runZhihuFavoritesSync, zhihuAutoSyncPolicy } from './sections/zhihu/zhihu-sync-adapter';

/**
 * Daily auto-sync Adapter for every persisted Collection platform: the
 * platform's shared Sync Adapter (the SAME function its manual page runs)
 * paired with the trigger policy declared next to it. Pure aggregation — no
 * sync semantics and no hand-written job namespace live here. Declaration
 * order is the coordinator's evaluation order.
 */
export const AUTO_SYNC_PLATFORM_BY_COLLECTION: Record<CollectionPlatform, AutoSyncDefinition> = {
  github: { runSync: runGithubStarsSync, ...githubAutoSyncPolicy },
  x: { runSync: runXBookmarksSync, ...xAutoSyncPolicy },
  zhihu: { runSync: runZhihuFavoritesSync, ...zhihuAutoSyncPolicy },
  youtube: { runSync: runYoutubePlaylistsSync, ...youtubeAutoSyncPolicy },
  bookmarks: { runSync: runBookmarksSync, ...bookmarksAutoSyncPolicy },
  // No preferFolderId: the API's natural Source order runs.
  bilibili: { runSync: runBilibiliSync, ...bilibiliAutoSyncPolicy },
};

/** Fully-keyed entries for `useDailyAutoSync`; `App.tsx` injects this list. */
export const AUTO_SYNC_PLATFORMS: AutoSyncPlatform[] = (
  Object.keys(AUTO_SYNC_PLATFORM_BY_COLLECTION) as CollectionPlatform[]
).map((itemPlatform) => ({
  itemPlatform,
  jobPlatform: jobPlatformForCollection(itemPlatform),
  ...AUTO_SYNC_PLATFORM_BY_COLLECTION[itemPlatform],
}));
