import { syncBookmarks } from '@/lib/bookmarks/bookmarks-sync-service';
import type { CooperativeCheckpoint } from '@/lib/collections';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { startCollectionProcessingJobs } from '../../hooks/collection-processing-jobs';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'bookmarks';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

/** Metadata-sync progress — the bookmark tree has no upfront total. */
export interface BookmarksSyncProgress {
  done: number;
  total: number | null;
}

/**
 * The bookmarks platform Sync Adapter — the single implementation of what a
 * bookmarks sync means: the local `chrome.bookmarks` tree sync, the chained
 * content-extraction stage, and the backlog embed dispatch. Both the manual
 * page (mount auto-sync + fetch button) and the daily auto-sync coordinator
 * run this exact function. Local browser data — no auth to resolve.
 */
export async function runBookmarksSync(
  onProgress: (progress: BookmarksSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ done: 0, total: null });
  const result = await syncBookmarks(control);
  onProgress({ done: result.totalBookmarks, total: null });
  // Chain the content-extraction worker after new bookmarks land as 'pending'.
  // Fire-and-forget module singleton — survives route changes, its startJob
  // guard dedupes concurrent starts, and the library gate can pause it. The
  // dynamic import keeps the extraction worker (defuddle/linkedom) in the lazy
  // bookmarks chunk instead of the eager app boot chunk; ESM modules are
  // singletons, so this is the same instance the bookmarks section uses.
  const { startBookmarkExtraction } = await import('./use-bookmark-extraction');
  startBookmarkExtraction();
  // Drain the embed backlog too: bookmarks left 'chunked' by an interrupted
  // earlier run are not re-picked by extraction (it only sees 'pending'), so
  // the batch embed lane is their retry path. Empty ids = backlog-only
  // dispatch, no tag lane.
  startCollectionProcessingJobs({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: ITEM_PLATFORM,
    itemIds: [],
  });
}

/** Daily auto-sync trigger policy: local browser data — always ready. */
export const bookmarksAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => true,
};
