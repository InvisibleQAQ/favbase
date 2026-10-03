import { getPlaylistVideos, getPlaylistCounts } from '@/lib/youtube/youtube-sync-service';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { useCredentialGatedLibrary } from '../../hooks/use-credential-gated-library';
import { runYoutubePlaylistsSync, youtubeCredentials } from './youtube-sync-adapter';

const PLATFORM = 'youtube';
/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

/** Playlist chip → `getPlaylistVideos({ playlistId })`; module-level, so stable. */
const queryFn = facetQuery(getPlaylistVideos, 'playlistId');

/**
 * Thin adapter over the shared collection-library state machine, behind the
 * config gate: API key + channel both live in UserSettings — one synchronous
 * gate (the old async authorization probe died with OAuth). Unconfigured, the
 * view shows the connect guide and `sync` is a silent no-op. The sync is a
 * manual button, never auto-on-mount: a remote, quota'd endpoint, and
 * playlist order is position order, so there is no incremental cutoff.
 */
export function useYoutubePlaylists() {
  return useCredentialGatedLibrary(youtubeCredentials, {
    queryFn,
    facetsFn: getPlaylistCounts,
    platform: PLATFORM,
    // The shared Sync Adapter (module ref = stable): config resolution, progress
    // mapping and the post-sync embed/tag dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runYoutubePlaylistsSync,
    jobPlatform: JOB_PLATFORM,
  });
}
