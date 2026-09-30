import type { CooperativeCheckpoint } from '@/lib/collections';
import { getDb } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import { getXAuth } from '@/lib/x/x-auth';
import { syncBookmarks, XAuthError } from '@/lib/x/x-sync-service';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';
import { remainingCooldown } from './cooldown';

const ITEM_PLATFORM = 'x';

/** Progress for the (cursor-paginated) X sync — total is unknowable, so this is
 *  always indeterminate; we surface the running fetched count + page number. */
export interface XSyncProgress {
  fetchedCount: number;
  page: number;
}

/**
 * The X platform Sync Adapter — the single implementation of what an X sync
 * means: captured-session auth resolution, then the cursor-paginated domain
 * sync with typed progress run through the Platform Sync funnel (attempt
 * record + post-sync embed/tag dispatch). The funnel's success record carries
 * the "N new this run" count and the cooldown anchor, so an auto-sync updates
 * the page's caption/cooldown just like a manual one. Both the manual
 * collection page and the daily auto-sync coordinator run this exact
 * function; trigger policy (the daily cooldown-aware readiness probe) stays
 * with the callers.
 */
export async function runXBookmarksSync(
  onProgress: (progress: XSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ fetchedCount: 0, page: 0 });
  // Auth is resolved HERE (app.html is a storage-capable trusted context);
  // syncBookmarks itself never touches storage — it also runs import-safe for
  // the offscreen document, which has no chrome.storage. A missing captured
  // session is known from storage alone, so it throws BEFORE the funnel: not
  // an attempt, no record (docs/32 §5.2). The page's logged-out state still
  // keys off this same error class.
  const auth = await getXAuth();
  if (!auth) throw new XAuthError('Not logged in to x.com', 'no-token');
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncBookmarks(
      auth,
      (fetchedCount, page) => {
        onProgress({ fetchedCount, page });
      },
      control,
    );
    return { fetched: result.total, inserted: result.inserted, newItemIds: result.newItemIds };
  });
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
