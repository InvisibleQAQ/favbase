import type { CooperativeCheckpoint } from '@/lib/collections';
import { settingsStorage } from '@/lib/storage';
import {
  syncYoutubePlaylists,
  type YoutubePlaylistsProgress,
} from '@/lib/youtube/youtube-sync-service';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { startCollectionProcessingJobs } from '../../hooks/collection-processing-jobs';

const ITEM_PLATFORM = 'youtube';
const JOB_PLATFORM = jobPlatformForCollection(ITEM_PLATFORM);

/**
 * The youtube platform Sync Adapter — the single implementation of what a
 * youtube sync means: API-key config resolution, the full-refetch domain sync
 * with typed progress, and the shared post-sync embed/tag dispatch. Both the
 * manual collection page and the daily auto-sync coordinator run this exact
 * function; trigger policy (the UI config gate, the daily readiness probe)
 * stays with the callers. Missing config is a silent no-op.
 */
export async function runYoutubePlaylistsSync(
  onProgress: (progress: YoutubePlaylistsProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  const settings = await settingsStorage.getValue();
  if (!settings.youtubeApiKey || !settings.youtubeChannel) return;
  onProgress({ fetchedCount: 0, playlistIndex: 0, playlistCount: 0 });
  const result = await syncYoutubePlaylists(
    { apiKey: settings.youtubeApiKey, channel: settings.youtubeChannel },
    onProgress,
    control,
  );
  // Auto-tag + auto-embed the descriptions just persisted, registered as
  // background jobs (survive route switches, cross-mount dedupe, feed the
  // global "don't close" reminder, done/total captions).
  startCollectionProcessingJobs({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: ITEM_PLATFORM,
    itemIds: result.newItemIds,
  });
}
