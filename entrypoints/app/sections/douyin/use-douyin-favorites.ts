import { getDouyinItems, getFolderCounts } from '@/lib/douyin/douyin-sync-service';
import { useCollectionLibrary } from '../../hooks/use-collection-library';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { runDouyinSync } from './douyin-sync-adapter';

const PLATFORM = 'douyin';
/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

/** Public-folder chip → `getDouyinItems({ folderId })`; module-level, so stable. */
const queryFn = facetQuery(getDouyinItems, 'folderId');

/**
 * Thin adapter over the shared collection-library state machine. Rows come
 * from PGlite via douyin-sync-service — no API reads. The sync is a manual
 * button, never auto-on-mount: it needs the user's own douyin.com tab and a
 * first full run is paced at roughly 2 minutes per 100 favorites.
 */
export function useDouyinFavorites() {
  return useCollectionLibrary({
    queryFn,
    facetsFn: getFolderCounts,
    platform: PLATFORM,
    // The shared Sync Adapter (module ref = stable): the tab gate, the
    // breakpoint and the per-page embed/tag dispatch live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runDouyinSync,
    jobPlatform: JOB_PLATFORM,
  });
}
