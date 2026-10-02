import {
  getStarredRepos,
  getLanguageCounts,
  getLastSyncedAt,
} from '@/lib/github/github-sync-service';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { useCredentialGatedLibrary } from '../../hooks/use-credential-gated-library';
import { githubCredentials, runGithubStarsSync } from './github-sync-adapter';

/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection('github');

/** Language chip → `getStarredRepos({ language })`; module-level, so stable. */
const queryFn = facetQuery(getStarredRepos, 'language');

/**
 * Thin adapter over the shared collection-library state machine, behind the
 * stored-token gate: without a token the view shows the connect guide
 * (`configured: false`) and `sync` is a silent no-op. Rows come from PGlite
 * via github-sync-service — no API reads.
 */
export function useGithubStars() {
  return useCredentialGatedLibrary(githubCredentials, {
    queryFn,
    facetsFn: getLanguageCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): token resolution, progress
    // mapping and the post-sync embed/tag dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runGithubStarsSync,
    jobPlatform: JOB_PLATFORM,
  });
}
