import type { CooperativeCheckpoint } from '@/lib/collections';
import { settingsStorage } from '@/lib/storage';
import {
  syncYoutubePlaylists,
  type YoutubePlaylistsProgress,
} from '@/lib/youtube/youtube-sync-service';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'youtube';

/**
 * The youtube platform Sync Adapter — the single implementation of what a
 * youtube sync means: API-key config resolution, then the full-refetch domain
 * sync with typed progress run through the Platform Sync funnel (attempt
 * record + post-sync embed/tag dispatch). Both the manual collection page and
 * the daily auto-sync coordinator run this exact function; trigger policy (the
 * UI config gate, the daily readiness probe) stays with the callers. Missing
 * config is a silent no-op that records nothing.
 */
export async function runYoutubePlaylistsSync(
  onProgress: (progress: YoutubePlaylistsProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  const settings = await settingsStorage.getValue();
  if (!settings.youtubeApiKey || !settings.youtubeChannel) return;
  onProgress({ fetchedCount: 0, playlistIndex: 0, playlistCount: 0 });
  const config = { apiKey: settings.youtubeApiKey, channel: settings.youtubeChannel };
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncYoutubePlaylists(config, onProgress, control);
    return { fetched: result.entries, inserted: result.inserted, newItemIds: result.newItemIds };
  });
}

/** Daily auto-sync trigger policy: both the API key and the channel are configured. */
export const youtubeAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => {
    const settings = await settingsStorage.getValue();
    return Boolean(settings.youtubeApiKey && settings.youtubeChannel);
  },
};
