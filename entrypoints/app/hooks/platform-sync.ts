import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { initDbProxy } from '@/lib/database';
import {
  recordPlatformSyncAttempt,
  recordPlatformSyncFailure,
  recordPlatformSyncSuccess,
  type PlatformSyncSuccess,
} from '@/lib/database/platform-sync-record';

import { jobPlatformForCollection } from './collection-job-platform';
import { startCollectionProcessingJobs } from './collection-processing-jobs';

/** What one successful Platform Sync reports back to the funnel. */
export interface PlatformSyncOutcome {
  /** Collection entries read from the platform this run — the final count the progress caption showed. */
  fetched: number;
  /** Items newly inserted this run — the page's "N new". */
  inserted: number;
  /** platformItemIds for the batch tag lane; [] when the platform processes per item itself (bilibili / bookmarks). */
  newItemIds: string[];
}

export interface PlatformSyncDeps {
  now(): Date;
  recordAttempt(platform: CollectionPlatform, at: Date): Promise<void>;
  recordSuccess(platform: CollectionPlatform, success: PlatformSyncSuccess): Promise<void>;
  recordFailure(platform: CollectionPlatform): Promise<void>;
  dispatch: typeof startCollectionProcessingJobs;
}

// `initDbProxy()` is idempotent and resolves to the same instance `getDb()`
// returns once ready — awaiting it here closes the window where a sync starts
// before app.html's fire-and-forget init has settled.
const defaultDeps: PlatformSyncDeps = {
  now: () => new Date(),
  recordAttempt: async (platform, at) =>
    recordPlatformSyncAttempt(await initDbProxy(), platform, at),
  recordSuccess: async (platform, success) =>
    recordPlatformSyncSuccess(await initDbProxy(), platform, success),
  recordFailure: async (platform) => recordPlatformSyncFailure(await initDbProxy(), platform),
  dispatch: startCollectionProcessingJobs,
};

/**
 * The Platform Sync funnel (docs/32 Step 1): the single place a Platform Sync
 * is recorded and its processing lanes dispatched. Each platform's Sync
 * Adapter calls it INSIDE its own function body, around the part that talks
 * to the platform — credential checks that need no network stay before it,
 * so "credentials known missing" is not an attempt and leaves no record.
 *
 * Order: checkpoint (a born-paused run records nothing until resumed) →
 * record the attempt → sync → on failure record it and rethrow the ORIGINAL
 * error → on success dispatch the embed/tag lanes, then record the success.
 * A failed success-write fails the job with the lanes already dispatched and
 * the record left unfinished (still today's attempt).
 *
 * No trigger policy lives here — silent errors, the daily gate and the
 * library gate belong to the callers.
 */
export async function runPlatformSync(
  platform: CollectionPlatform,
  control: CooperativeCheckpoint,
  sync: () => Promise<PlatformSyncOutcome>,
  deps: PlatformSyncDeps = defaultDeps,
): Promise<void> {
  await control.checkpoint();
  await deps.recordAttempt(platform, deps.now());

  let outcome: PlatformSyncOutcome;
  try {
    outcome = await sync();
  } catch (err) {
    await recordFailureQuietly(platform, deps);
    throw err;
  }

  deps.dispatch({
    jobPlatform: jobPlatformForCollection(platform),
    itemPlatform: platform,
    itemIds: outcome.newItemIds,
  });
  await deps.recordSuccess(platform, {
    at: deps.now(),
    fetched: outcome.fetched,
    inserted: outcome.inserted,
  });
}

/** A record-write failure must never mask the sync failure that caused it. */
async function recordFailureQuietly(
  platform: CollectionPlatform,
  deps: PlatformSyncDeps,
): Promise<void> {
  try {
    await deps.recordFailure(platform);
  } catch (recordErr) {
    console.error(`[platform-sync] ${platform} failure record failed:`, recordErr);
  }
}
