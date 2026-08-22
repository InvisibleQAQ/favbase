import { useEffect, useRef } from 'react';

import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { getDb, initDbProxy } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';

import { startJob } from './background-jobs-store';
import type { CollectionJobPlatform } from './collection-job-platform';
import { shouldAutoSync } from './daily-sync-gate';
import { isLibraryPaused } from './library-gate';

/**
 * Minimum gap between two full-registry evaluations. Guards against a DB-query
 * storm when the user rapidly toggles tab visibility — one cheap evaluation per
 * 30s window is plenty (the daily gate + startJob dedupe absorb the rest).
 */
export const EVALUATE_THROTTLE_MS = 30_000;

/**
 * A platform's automatic-sync trigger policy, declared next to its Sync
 * Adapter (`sections/<platform>/<platform>-sync-adapter.ts`). Zero sync
 * semantics live here — only "is auto-sync worth attempting right now" and
 * "which thrown error means logged-out rather than failed".
 */
export interface AutoSyncPolicy {
  /** Live readiness probe — zero persistence. False => silently skipped. */
  probeReady(): Promise<boolean>;
  /**
   * When true for a thrown error, treat it as "not ready / logged out": complete
   * the job silently instead of marking it failed (e.g. zhihu logged out).
   */
  isSilentError?(err: unknown): boolean;
}

/** Trigger policy paired with the platform's shared Sync Adapter. */
export interface AutoSyncDefinition extends AutoSyncPolicy {
  /**
   * The platform's shared Sync Adapter — the SAME function the manual
   * collection page runs (missing auth/config is a silent no-op). It owns
   * auth/config resolution, the domain sync with typed progress, platform
   * persistence side effects, and the post-sync processing dispatch; the
   * coordinator only adds trigger policy around it.
   */
  runSync(
    setProgress: (progress: unknown) => void,
    control: CooperativeCheckpoint,
  ): Promise<void>;
}

/**
 * One fully-keyed registry entry as the coordinator consumes it. The app root
 * (`collection-platform-auto-sync.ts`) aggregates the per-platform definitions
 * and derives `jobPlatform`; this hooks directory never imports a section.
 */
export interface AutoSyncPlatform extends AutoSyncDefinition {
  /** startJob namespace key (e.g. 'github-stars'), derived via jobPlatformForCollection. */
  jobPlatform: CollectionJobPlatform;
  /** DB platform discriminator (e.g. 'github'), for the daily gate query. */
  itemPlatform: CollectionPlatform;
}

export interface DailyAutoSyncDeps {
  initDb: () => Promise<unknown>;
  now: () => Date;
  getLastSynced: (platform: string) => Promise<Date | null>;
  isPaused: (jobPlatform: string) => boolean;
  startJob: typeof startJob;
}

const defaultDeps: DailyAutoSyncDeps = {
  initDb: initDbProxy,
  now: () => new Date(),
  getLastSynced: (platform) => getPlatformLastSyncedAt(platform, getDb()),
  isPaused: isLibraryPaused,
  startJob,
};

async function evaluatePlatform(
  platform: AutoSyncPlatform,
  deps: DailyAutoSyncDeps,
): Promise<void> {
  const last = await deps.getLastSynced(platform.itemPlatform);
  if (!shouldAutoSync(last, deps.now())) return;
  // Gate check BEFORE the probe: a paused platform sends no auth request and
  // never refreshes sources.lastFetchedAt, so the day's sync still happens on
  // the first evaluation after the user resumes. (startJob's born-paused path
  // is the second line of defence; this one just avoids the noise job.)
  if (deps.isPaused(platform.jobPlatform)) return;
  if (!(await platform.probeReady())) return;

  // The shared Sync Adapter owns everything past this point (auth resolution,
  // domain sync, persistence side effects, processing dispatch) — the runner
  // only adds the auto trigger's silent-error policy.
  deps.startJob(platform.jobPlatform, 'sync', async (setProgress, control) => {
    try {
      await platform.runSync(setProgress, control);
    } catch (err) {
      // A logged-out / not-ready error is not a failure — complete silently.
      if (platform.isSilentError?.(err)) return;
      throw err;
    }
  });
}

/**
 * Daily first-open auto-sync coordinator. Mounted once at the app.html top level
 * (App.tsx, which injects the app-root `AUTO_SYNC_PLATFORMS` registry) so it
 * runs regardless of the active route. On mount and whenever the
 * tab becomes visible again, it re-evaluates every platform's per-day gate and
 * dispatches a sync for each ready platform that hasn't synced today. Manual
 * syncs share `sources.lastFetchedAt`, so a manually-synced platform is skipped.
 *
 * StrictMode double-invoke and rapid tab toggling are idempotent: the daily gate
 * + `startJob` dedupe + the throttle below make repeat evaluations harmless.
 */
export function useDailyAutoSync(
  platforms: AutoSyncPlatform[],
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
