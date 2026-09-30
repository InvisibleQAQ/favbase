import type { CooperativeCheckpoint } from '@/lib/collections';
import { syncFavorites, ZhihuAuthError } from '@/lib/zhihu/zhihu-sync-service';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'zhihu';

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
 * sync means: the serial paced domain sync with typed progress, run through
 * the Platform Sync funnel (attempt record + post-sync embed/tag dispatch).
 * Auth is the browser's own zhihu cookie jar (credentials:'include' + host
 * permission) — nothing to resolve here, and no way to tell "logged out"
 * without the network, so the whole sync is inside the funnel: a logged-out
 * session surfaces as ZhihuAuthError from the fetch layer and IS a recorded
 * attempt (docs/32 D2, cost 1). How that error is presented (manual error
 * state vs silent auto skip) stays with the callers.
 */
export async function runZhihuFavoritesSync(
  onProgress: (progress: ZhihuSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ fetchedCount: 0, current: 0, total: 0 });
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncFavorites(
      (fetchedCount, current, totalCollections) => {
        onProgress({ fetchedCount, current, total: totalCollections });
      },
      control,
    );
    return { fetched: result.total, inserted: result.inserted, newItemIds: result.newItemIds };
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
