import { useEffect } from 'react';

import {
  getBookmarks,
  getFolders,
  type BookmarkItem,
  type BookmarkFolderRef,
} from '@/lib/bookmarks/bookmarks-sync-service';
import {
  useCollectionLibrary,
  type UseCollectionLibraryReturn,
} from '../../hooks/use-collection-library';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { runBookmarksSync, type BookmarksSyncProgress } from './bookmarks-sync-adapter';

const PLATFORM = 'bookmarks';
/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

/** The generic library minus its filter: the route owns the folder, so the view
 *  never sees `filter` (and `setFilter` would be a controlled no-op). */
export type UseBookmarksReturn = Omit<
  UseCollectionLibraryReturn<BookmarkItem, BookmarkFolderRef, BookmarksSyncProgress>,
  'filter' | 'setFilter'
>;

/** `filter` is the route folder id; `null` (route "All") = whole library. */
const queryFn = facetQuery(getBookmarks, 'folderId');

/**
 * Thin adapter over the shared collection-library state machine. Bookmarks'
 * only deviations from the flat remote pages live here: the folder filter is
 * CONTROLLED by the route (`/collections/bookmarks/:folderId`, undefined =
 * "All"), and the sync auto-runs on mount (local data is instant — no button
 * gate; the job store dedupes against the daily coordinator and the fetch
 * button, so a remount re-joins an in-flight run).
 */
export function useBookmarks(folderId: string | undefined): UseBookmarksReturn {
  const lib = useCollectionLibrary({
    queryFn,
    facetsFn: getFolders,
    platform: PLATFORM,
    // The shared Sync Adapter (module ref = stable): tree sync, chained content
    // extraction and the backlog embed dispatch all live there — the daily
    // auto-sync coordinator runs the exact same function.
    syncFn: runBookmarksSync,
    jobPlatform: JOB_PLATFORM,
    controlledFilter: folderId ?? null,
  });

  const { sync } = lib;
  useEffect(() => {
    void sync();
  }, [sync]);

  return lib;
}
