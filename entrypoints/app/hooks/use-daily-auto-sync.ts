import { useEffect, useRef } from 'react';

import { getDb, initDbProxy } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';

import { AUTO_SYNC_PLATFORMS, type AutoSyncPlatform } from './auto-sync-registry';
import { startJob } from './background-jobs-store';
import { startCollectionProcessingJobs } from './collection-processing-jobs';
import { shouldAutoSync } from './daily-sync-gate';

/**
 * Minimum gap between two full-registry evaluations. Guards against a DB-query
 * storm when the user rapidly toggles tab visibility — one cheap evaluation per
 * 30s window is plenty (the daily gate + startJob dedupe absorb the rest).
 */
export const EVALUATE_THROTTLE_MS = 30_000;

export interface DailyAutoSyncDeps {
  initDb: () => Promise<unknown>;
  now: () => Date;
  getLastSynced: (platform: string) => Promise<Date | null>;
  startJob: typeof startJob;
  startProcessing: typeof startCollectionProcessingJobs;
}

const defaultDeps: DailyAutoSyncDeps = {
  initDb: initDbProxy,
  now: () => new Date(),
  getLastSynced: (platform) => getPlatformLastSyncedAt(platform, getDb()),
  startJob,
  startProcessing: startCollectionProcessingJobs,
};

async function evaluatePlatform(
  platform: AutoSyncPlatform,
  deps: DailyAutoSyncDeps,
): Promise<void> {
  const last = await deps.getLastSynced(platform.itemPlatform);
  if (!shouldAutoSync(last, deps.now())) return;
  if (!(await platform.probeReady())) return;

  deps.startJob(platform.jobPlatform, 'sync', async (setProgress, control) => {
    try {
      const itemIds = await platform.runSync(setProgress, control);
      deps.startProcessing({
        jobPlatform: platform.jobPlatform,
        itemPlatform: platform.itemPlatform,
        itemIds,
      });
    } catch (err) {
      // A logged-out / not-ready error is not a failure — complete silently.
      if (platform.isSilentError?.(err)) return;
      throw err;
    }
  });
}

/**
 * Daily first-open auto-sync coordinator. Mounted once at the app.html top level
 * (App.tsx) so it runs regardless of the active route. On mount and whenever the
 * tab becomes visible again, it re-evaluates every platform's per-day gate and
 * dispatches a sync for each ready platform that hasn't synced today. Manual
 * syncs share `sources.lastFetchedAt`, so a manually-synced platform is skipped.
 *
 * StrictMode double-invoke and rapid tab toggling are idempotent: the daily gate
 * + `startJob` dedupe + the throttle below make repeat evaluations harmless.
 */
export function useDailyAutoSync(
  platforms: AutoSyncPlatform[] = AUTO_SYNC_PLATFORMS,
  deps: DailyAutoSyncDeps = defaultDeps,
): void {
  const lastEvalAtRef = useRef<number>(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    let disposed = false;

    const evaluate = async (): Promise<void> => {
      const nowMs = deps.now().getTime();
      if (nowMs - lastEvalAtRef.current < EVALUATE_THROTTLE_MS) return;
      lastEvalAtRef.current = nowMs;

      try {
        await deps.initDb();
      } catch (err) {
        console.error('[daily-auto-sync] initDb failed:', err);
        return;
      }
      if (disposed) return;

      // Platforms are independent — one platform's failure never blocks another.
      await Promise.all(
        platforms.map((platform) =>
          evaluatePlatform(platform, deps).catch((err) => {
            console.error(`[daily-auto-sync] ${platform.jobPlatform} evaluate failed:`, err);
          }),
        ),
      );
    };

    void evaluate();

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void evaluate();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Registry + deps are module-stable singletons; run once per mount.
  }, []);
}
