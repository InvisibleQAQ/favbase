import type { CooperativeCheckpoint } from '@/lib/collections';
import { getDb } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import { xLastSyncStorage, type XLastSync } from '@/lib/storage';
import { getXAuth } from '@/lib/x/x-auth';
import { syncBookmarks } from '@/lib/x/x-sync-service';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { startCollectionProcessingJobs } from '../../hooks/collection-processing-jobs';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';
import { remainingCooldown } from './cooldown';

const ITEM_PLATFORM = 'x';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

/** Progress for the (cursor-paginated) X sync — total is unknowable, so this is
 *  always indeterminate; we surface the running fetched count + page number. */
export interface XSyncProgress {
  fetchedCount: number;
  page: number;
}

/**
 * The X platform Sync Adapter — the single implementation of what an X sync
 * means: captured-session auth resolution, the cursor-paginated domain sync
 * with typed progress, the shared post-sync embed/tag dispatch, and the
 * persisted "N new this run" summary. Both the manual collection page and the
 * daily auto-sync coordinator run this exact function, so an auto-sync updates
 * the page's caption/cooldown just like a manual one. Trigger policy (the
 * daily cooldown-aware readiness probe) stays with the callers.
 */
export async function runXBookmarksSync(
  onProgress: (progress: XSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ fetchedCount: 0, page: 0 });
  // Auth is resolved HERE (app.html is a storage-capable trusted context);
  // syncBookmarks itself never touches storage — it also runs import-safe for
  // the offscreen document, which has no chrome.storage.
  const auth = await getXAuth();
  const result = await syncBookmarks(
    auth,
    (fetchedCount, page) => {
      onProgress({ fetchedCount, page });
    },
    control,
  );
  // Auto-tag + auto-embed the tweets just persisted, registered as background
  // jobs so they survive route switches, dedupe across mounts, feed the global
  // "don't close" reminder, and surface done/total progress captions.
  startCollectionProcessingJobs({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: ITEM_PLATFORM,
    itemIds: result.newItemIds,
  });
  // Persist the "N new this run" summary + the cooldown anchor. The page hook
  // subscribes to this storage item, so both triggers refresh its caption.
  const summary: XLastSync = { syncedAt: Date.now(), inserted: result.inserted };
  await xLastSyncStorage.setValue(summary);
}

/**
 * Daily auto-sync trigger policy: captured auth present AND outside the
 * 5-minute cooldown. The daily gate already blocks same-day re-sync, but a
 * sync at 23:58 followed by a next-day evaluation at 00:01 would otherwise
 * fire inside the cooldown.
 */
export const xAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => {
    if ((await getXAuth()) === null) return false;
    const last = await getPlatformLastSyncedAt(ITEM_PLATFORM, getDb());
    return remainingCooldown(last ? last.getTime() : null, Date.now()) === 0;
  },
};
