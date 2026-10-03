import type { CooperativeCheckpoint } from '@/lib/collections';
import { DouyinAuthError, syncDouyinCollections } from '@/lib/douyin/douyin-sync-service';
import { douyinTabTransport, findDouyinTab } from '@/lib/douyin/douyin-tab';
import { douyinBackfillStorage } from '@/lib/storage';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { enqueueCollectionProcessingItem } from '../../hooks/collection-processing-jobs';
import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'douyin';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

/** Progress for the Douyin sync — no total is knowable; the running count and page. */
export interface DouyinSyncProgress {
  fetchedCount: number;
  page: number;
}

/**
 * The Douyin platform Sync Adapter — the single implementation of what a
 * Douyin sync means. Every request runs in the user's own logged-in
 * www.douyin.com tab (docs/33 D3 / D4), so the tab gate comes first: with no
 * usable tab the platform cannot even be asked, which is known without the
 * network — `DouyinAuthError('missing')` BEFORE the funnel, not an attempt, no
 * record (docs/32 §5.2; docs/33 F1). The page's not-logged-in state keys off
 * the same class. A tab that is open but logged out is only found out by a
 * request (F7), inside the funnel, and that one IS a recorded attempt.
 *
 * Inside the funnel: read the backfill breakpoint, run the paced domain sync
 * through the tab transport, write the breakpoint back on every change. Pages
 * are persisted as they arrive, so their items are dispatched to the embed /
 * tag lanes per page, here (docs/33 D-b) — a run that fails at page 80 must
 * not leave 79 pages of items chunked and never processed, and the funnel
 * only dispatches on success. The funnel therefore gets `newItemIds: []`;
 * its success-time embed backlog pass still runs.
 *
 * The manual page and the daily auto-sync coordinator run this same function.
 */
export async function runDouyinSync(
  onProgress: (progress: DouyinSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ fetchedCount: 0, page: 0 });
  if ((await findDouyinTab()) === null) {
    throw new DouyinAuthError('No usable www.douyin.com tab is open', 'missing');
  }
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const backfill = await douyinBackfillStorage.getValue();
    const result = await syncDouyinCollections(douyinTabTransport, {
      backfill,
      onBackfill: (state) => douyinBackfillStorage.setValue(state),
      // `itemId` is the platformItemId (aweme_id): the embed / tag lanes
      // resolve it against `items.platform_item_id`.
      onPagePersisted: (platformItemIds) => {
        for (const itemId of platformItemIds) {
          enqueueCollectionProcessingItem({
            jobPlatform: JOB_PLATFORM,
            itemPlatform: ITEM_PLATFORM,
            itemId,
          });
        }
      },
      onProgress: (fetchedCount, page) => onProgress({ fetchedCount, page }),
      control,
    });
    return { fetched: result.fetched, inserted: result.inserted, newItemIds: [] };
  });
}

/**
 * Daily auto-sync trigger policy: ready only while a usable douyin.com tab is
 * open — the same resolver as the gate above and the transport (D-c), so a
 * discarded or loading tab never burns the day's slot. favbase never opens a
 * tab itself (D3). A logged-out tab (`DouyinAuthError` from the request)
 * completes silently instead of failing the job.
 */
export const douyinAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => (await findDouyinTab()) !== null,
  isSilentError: (err) => err instanceof DouyinAuthError,
};
