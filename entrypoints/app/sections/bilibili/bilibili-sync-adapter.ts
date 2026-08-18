import {
  fetchAndSyncFolders,
  type BiliFavoritesSyncProgress,
} from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';
import type { CooperativeCheckpoint } from '@/lib/collections';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { startCollectionProcessingJobs } from '../../hooks/collection-processing-jobs';

const ITEM_PLATFORM = 'bilibili';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

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
 * bilibili sync means: folder sync, the streaming Fetch→durable item→Transcript
 * runtime, and the backlog embed dispatch. Both the manual page and the daily
 * auto-sync coordinator run this exact function; only the Fetch-producer
 * priority (`preferFolderId`) and UI mirroring (`onFolders`) vary per trigger.
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
  const folders = await fetchAndSyncFolders(control);
  onFolders?.(folders);
  // Dynamic import keeps the transcription runtime out of the eager app boot
  // chunk; ESM modules are singletons, so this is the same pipeline instance
  // the bilibili section uses.
  const { runBiliStreamingSync } = await import('./auto-transcribe-runtime');
  await runBiliStreamingSync(orderFolders(folders, preferFolderId), onProgress, control);
  // Transcription enqueues embed/tag per durable item itself; the batch embed
  // lane (empty ids = backlog-only) retries items an earlier interrupted run
  // left 'chunked'.
  startCollectionProcessingJobs({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: ITEM_PLATFORM,
    itemIds: [],
  });
}
