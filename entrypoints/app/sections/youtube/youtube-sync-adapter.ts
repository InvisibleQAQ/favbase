import type { CooperativeCheckpoint } from '@/lib/collections';
import { settingsStorage, type UserSettings } from '@/lib/storage';
import {
  syncYoutubePlaylists,
  type YoutubePlaylistsProgress,
  type YoutubeSyncConfig,
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
  const config = youtubeCredentials(await settingsStorage.getValue());
  if (config === null) return;
  onProgress({ fetchedCount: 0, playlistIndex: 0, playlistCount: 0 });
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncYoutubePlaylists(config, onProgress, control);
    return { fetched: result.entries, inserted: result.inserted, newItemIds: result.newItemIds };
  });
}

/**
 * The API key + channel, or `null` unless both are set — the single "is
 * YouTube configured" check. The run gate above, the daily probe below and
 * the page gate (`useCredentialGatedLibrary`) all read it.
 */
export function youtubeCredentials(settings: UserSettings): YoutubeSyncConfig | null {
  const { youtubeApiKey: apiKey, youtubeChannel: channel } = settings;
  return apiKey && channel ? { apiKey, channel } : null;
}

/** Daily auto-sync trigger policy: both the API key and the channel are configured. */
export const youtubeAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => youtubeCredentials(await settingsStorage.getValue()) !== null,
};
