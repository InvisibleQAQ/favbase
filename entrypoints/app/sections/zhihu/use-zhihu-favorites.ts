import {
  getFavorites,
  getCollectionCounts,
  getLastSyncedAt,
} from '@/lib/zhihu/zhihu-sync-service';
import { useCollectionLibrary } from '../../hooks/use-collection-library';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { runZhihuFavoritesSync } from './zhihu-sync-adapter';

/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection('zhihu');

/** Collection chip → `getFavorites({ collectionId })`; module-level, so stable. */
const queryFn = facetQuery(getFavorites, 'collectionId');

/**
 * Thin adapter over the shared collection-library state machine. Rows come
 * from PGlite via zhihu-sync-service — no API reads. The sync is a manual
 * button, never auto-on-mount: a remote, rate-limited endpoint.
 */
export function useZhihuFavorites() {
  return useCollectionLibrary({
    queryFn,
    facetsFn: getCollectionCounts,
    lastSyncedFn: getLastSyncedAt,
    // The shared Sync Adapter (module ref = stable): progress mapping and the
    // post-sync embed/tag dispatch live there — the daily auto-sync coordinator
    // runs the exact same function.
    syncFn: runZhihuFavoritesSync,
    jobPlatform: JOB_PLATFORM,
  });
}
