import { useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { getPlatformSyncRecord } from '@/lib/database/platform-sync-record';
import { getBookmarks, getAuthorCounts } from '@/lib/x/x-sync-service';
import { useCollectionLibrary } from '../../hooks/use-collection-library';
import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { facetQuery } from '../../hooks/facet-query';
import { useCountdown } from '../../hooks/use-countdown';
import { remainingCooldown } from './cooldown';
import { runXBookmarksSync } from './x-sync-adapter';

const PLATFORM = 'x';
/** Background-job namespace — the domain Platform Descriptor's `jobPlatform`,
 *  which keys this page's sync / embed / tag jobs in `useCollectionLibrary`. */
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

/** Author chip → `getBookmarks({ author })`; module-level, so stable. */
const queryFn = facetQuery(getBookmarks, 'author');

/** Thin adapter over the shared library (manual sync — never auto-on-mount, D5) plus X's
 *  own `lastInserted` ("N new this run") and `cooldownRemainingMs` (0 = ready). */
export function useXBookmarks() {
  const lib = useCollectionLibrary({
    queryFn,
    facetsFn: getAuthorCounts,
    platform: PLATFORM,
    // The shared Sync Adapter (module ref = stable): auth resolution, progress mapping
    // and — through the Platform Sync funnel — the post-sync embed/tag dispatch and the
    // Platform Sync Record; the daily auto-sync coordinator runs the exact same function.
    syncFn: runXBookmarksSync,
    jobPlatform: JOB_PLATFORM,
  });

  // "N new this run" = the Platform Sync Record's `lastInserted`, written with
  // the success that `lib.lastSyncedAt` reads. Re-read whenever the sync job's
  // generation moves — it only moves on success, exactly when the count does —
  // so an auto-sync finishing while this page is mounted refreshes the caption
  // just like a manual one.
  const syncGeneration = lib.syncJob?.generation ?? 0;
  const [lastInserted, setLastInserted] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = await getPlatformSyncRecord(PLATFORM, await initDbProxy());
      if (!cancelled) setLastInserted(record?.lastInserted ?? null);
    })().catch((err) => console.error(`[${JOB_PLATFORM}] sync record load failed:`, err));
    return () => {
      cancelled = true;
    };
  }, [syncGeneration]);

  // Cooldown anchor = the latest successful sync (Platform Sync Record, survives
  // reloads; a failed sync never moves it, so it never locks the button).
  const effectiveSyncedAt = lib.lastSyncedAt?.getTime() ?? null;

  // The shared 1 s countdown ticks while inside the cooldown window.
  const cooldownRemainingMs = useCountdown((now) => remainingCooldown(effectiveSyncedAt, now));

  return { ...lib, lastInserted, cooldownRemainingMs };
}
