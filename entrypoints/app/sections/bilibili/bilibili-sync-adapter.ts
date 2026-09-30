import {
  checkAuth,
  fetchAndSyncFolders,
  type BiliFavoritesSyncProgress,
} from '@/lib/bilibili/bili-sync-service';
import { getBiliAuth } from '@/lib/bilibili/bilibili-api';
import type { BiliFavFolder } from '@/lib/bilibili/types';
import type { CooperativeCheckpoint } from '@/lib/collections';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'bilibili';

export interface BilibiliSyncOptions {
  /**
   * Move this Source to the front of the Fetch producer (the manual page's
   * route-selected folder). The Transcript inbox inherits the order from
   * persisted page notifications; without it, the API's natural order runs.
   */
  preferFolderId?: number;
  /** Observe the freshly synced folder list (the manual page mirrors it to state). */
  onFolders?: (folders: BiliFavFolder[]) => void;
}

function orderFolders(folders: BiliFavFolder[], preferFolderId?: number): BiliFavFolder[] {
  if (preferFolderId == null) return folders;
  const selected = folders.find((folder) => folder.id === preferFolderId);
  if (!selected) return folders;
  return [selected, ...folders.filter((folder) => folder.id !== preferFolderId)];
}

/**
 * The bilibili platform Sync Adapter — the single implementation of what a
 * bilibili sync means: the no-network login gate, then folder sync and the
 * streaming Fetch→durable item→Transcript runtime through the Platform Sync
 * funnel (attempt record + backlog embed dispatch). Both the manual page and
 * the daily auto-sync coordinator run this exact function; only the
 * Fetch-producer priority (`preferFolderId`) and UI mirroring (`onFolders`)
 * vary per trigger.
 */
export async function runBilibiliSync(
  onProgress: (progress: BiliFavoritesSyncProgress) => void,
  control: CooperativeCheckpoint,
  { preferFolderId, onFolders }: BilibiliSyncOptions = {},
): Promise<void> {
  onProgress({
    fetchedCount: 0,
    folderIndex: 0,
    folderCount: 0,
    folderTitle: '',
    page: 0,
    totalPages: 0,
  });
  // Logged out is known from the cookie jar alone, so BiliAuthError is thrown
  // BEFORE the funnel: not an attempt, no record (docs/32 §5.2), and the
  // page's logged-out state still keys off this same error class.
  // fetchAndSyncFolders checks again — it also serves the page's mount path.
  await checkAuth();
  // Transcription enqueues embed/tag per durable item itself, so newItemIds is
  // empty: the funnel's batch embed lane (backlog-only) just retries items an
  // earlier interrupted run left 'chunked'.
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const folders = await fetchAndSyncFolders(control);
    onFolders?.(folders);
    // Dynamic import keeps the transcription runtime out of the eager app boot
    // chunk; ESM modules are singletons, so this is the same pipeline instance
    // the bilibili section uses.
    const { runBiliStreamingSync } = await import('./auto-transcribe-runtime');
    const result = await runBiliStreamingSync(
      orderFolders(folders, preferFolderId),
      onProgress,
      control,
    );
    return { fetched: result.fetchedCount, inserted: result.insertedCount, newItemIds: [] };
  });
}

/** Daily auto-sync trigger policy: a logged-in cookie session. */
export const bilibiliAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => (await getBiliAuth()) !== null,
};
