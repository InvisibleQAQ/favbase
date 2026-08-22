import type { CooperativeCheckpoint } from '@/lib/collections';
import { syncFavorites, ZhihuAuthError } from '@/lib/zhihu/zhihu-sync-service';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { startCollectionProcessingJobs } from '../../hooks/collection-processing-jobs';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'zhihu';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

/** Progress for the zhihu sync — collection cursor + cumulative fetched count.
 *  The bar stays indeterminate (per-collection item totals are lazy). */
export interface ZhihuSyncProgress {
  fetchedCount: number;
  /** 1-based index of the collection currently being fetched. */
  current: number;
  /** Total public collections. */
  total: number;
}

/**
 * The zhihu platform Sync Adapter — the single implementation of what a zhihu
 * sync means: the serial paced domain sync with typed progress plus the shared
 * post-sync embed/tag dispatch. Auth is the browser's own zhihu cookie jar
 * (credentials:'include' + host permission) — nothing to resolve here; a
 * logged-out session surfaces as ZhihuAuthError from the fetch layer, and how
 * that error is handled (manual error state vs silent auto skip) stays with
 * the callers.
 */
export async function runZhihuFavoritesSync(
  onProgress: (progress: ZhihuSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ fetchedCount: 0, current: 0, total: 0 });
  const result = await syncFavorites(
    (fetchedCount, current, totalCollections) => {
      onProgress({ fetchedCount, current, total: totalCollections });
    },
    control,
  );
  // Auto-tag + auto-embed the content just persisted, registered as background
  // jobs (survive route switches, cross-mount dedupe, feed the global "don't
  // close" reminder, done/total captions).
  startCollectionProcessingJobs({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: ITEM_PLATFORM,
    itemIds: result.newItemIds,
  });
}

/**
 * Daily auto-sync trigger policy: the cookie jar is always worth a try, and a
 * logged-out session (ZhihuAuthError) completes silently instead of failing.
 */
export const zhihuAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => true,
  isSilentError: (err) => err instanceof ZhihuAuthError,
};
