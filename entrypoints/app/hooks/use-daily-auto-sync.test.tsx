// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keep the hook module self-contained: stub the lib barrels so importing the
// hook never pulls chrome/AI deps. Platforms are injected per test — the hook
// has no registry default (the app root owns it).
vi.mock('./background-jobs-store', () => ({ startJob: vi.fn() }));
vi.mock('./library-gate', () => ({ isLibraryPaused: () => false }));
vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(), getDb: vi.fn() }));
vi.mock('@/lib/database/platform-sync-record', () => ({ getPlatformSyncRecord: vi.fn() }));
// The funnel's real dispatcher pulls the embedding/tagging barrels.
vi.mock('./collection-processing-jobs', () => ({ startCollectionProcessingJobs: vi.fn() }));

import type { CollectionPlatform } from '@/lib/collections/platforms';

import { runPlatformSync, type PlatformSyncDeps } from './platform-sync';
import {
  EVALUATE_THROTTLE_MS,
  useDailyAutoSync,
  type AutoSyncPlatform,
  type DailyAutoSyncDeps,
} from './use-daily-auto-sync';

const NOOP_CONTROL: CooperativeCheckpoint = { checkpoint: async () => {} };

/** Run a runner captured by the mock startJob and report if it rejected. */
interface StartedJob {
  jobPlatform: string;
  runner: (setProgress: (p: unknown) => void, control: CooperativeCheckpoint) => Promise<void>;
  rejected: boolean;
}

interface Clock {
  now: () => Date;
  set: (d: Date) => void;
}

function createClock(): Clock {
  let current = new Date(2026, 6, 26, 10, 0, 0);
  return { now: () => current, set: (d) => { current = d; } };
}

function makeDeps(overrides: Partial<DailyAutoSyncDeps> = {}, clock: Clock = createClock()): {
  deps: DailyAutoSyncDeps;
  started: StartedJob[];
  setNow: (d: Date) => void;
} {
  const started: StartedJob[] = [];

  const startJob = vi.fn((jobPlatform: string, _kind: string, runner: StartedJob['runner']) => {
    const record: StartedJob = { jobPlatform, runner, rejected: false };
    started.push(record);
    const settled = Promise.resolve(runner(() => {}, NOOP_CONTROL))
      .then(() => undefined)
      .catch(() => {
        record.rejected = true;
      });
    return { started: true, settled };
  }) as unknown as DailyAutoSyncDeps['startJob'];

  const deps: DailyAutoSyncDeps = {
    initDb: vi.fn(async () => undefined),
    now: clock.now,
    getLastAttempt: vi.fn(async () => null),
    isPaused: () => false,
    startJob,
    ...overrides,
  };

  return { deps, started, setNow: clock.set };
}

interface MemoryRecord {
  lastAttemptAt: Date;
  lastResult: 'success' | 'failure' | null;
}

/**
 * An in-memory Platform Sync Record: the real funnel writes it through
 * injected deps, the coordinator's gate reads the latest attempt from it —
 * one clock for both, so an attempt lands on the test's day.
 */
function recordStore(clock: Clock) {
  const records = new Map<CollectionPlatform, MemoryRecord>();
  const funnelDeps: PlatformSyncDeps = {
    now: clock.now,
    recordAttempt: async (platform, at) => {
      records.set(platform, { lastAttemptAt: at, lastResult: null });
    },
    recordSuccess: async (platform) => {
      records.get(platform)!.lastResult = 'success';
    },
    recordFailure: async (platform) => {
      records.get(platform)!.lastResult = 'failure';
    },
    dispatch: vi.fn(),
  };
  const getLastAttempt = vi.fn(
    async (platform: CollectionPlatform) => records.get(platform)?.lastAttemptAt ?? null,
  );
  return { records, funnelDeps, getLastAttempt };
}

/** A platform whose Sync Adapter runs the REAL funnel around `sync`. */
function funnelPlatform(
  itemPlatform: CollectionPlatform,
  jobPlatform: string,
  funnelDeps: PlatformSyncDeps,
  sync: () => Promise<{ fetched: number; inserted: number; newItemIds: string[] }>,
  over: Partial<AutoSyncPlatform> = {},
): AutoSyncPlatform {
  return platform({
    jobPlatform: jobPlatform as AutoSyncPlatform['jobPlatform'],
    itemPlatform,
    runSync: (_setProgress, control) => runPlatformSync(itemPlatform, control, sync, funnelDeps),
    ...over,
  });
}

function platform(over: Partial<AutoSyncPlatform> & Pick<AutoSyncPlatform, 'jobPlatform' | 'itemPlatform'>): AutoSyncPlatform {
  return {
    probeReady: async () => true,
    runSync: async () => undefined,
    ...over,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useDailyAutoSync', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(platforms: AutoSyncPlatform[], deps: DailyAutoSyncDeps): void {
    function Probe(): null {
      useDailyAutoSync(platforms, deps);
      return null;
    }
    act(() => root.render(<Probe />));
  }

  it('skips a platform already attempted today (gate not hit)', async () => {
    const { deps, started } = makeDeps({
      getLastAttempt: vi.fn(async () => new Date(2026, 6, 26, 2, 0, 0)),
    });
    render([platform({ jobPlatform: 'github-stars', itemPlatform: 'github' })], deps);
    await flush();
    expect(started).toHaveLength(0);
  });

  it('dispatches the shared Sync Adapter for a ready platform not attempted today', async () => {
    const runSync = vi.fn(async () => undefined);
    const { deps, started } = makeDeps({
      getLastAttempt: vi.fn(async () => new Date(2026, 6, 25, 10, 0, 0)),
    });
    render(
      [platform({ jobPlatform: 'github-stars', itemPlatform: 'github', runSync })],
      deps,
    );
    await flush();
    expect(started).toHaveLength(1);
    // Post-sync processing dispatch lives INSIDE the adapter, so the runner
    // hands it nothing but the job's progress sink + checkpoint.
    expect(runSync).toHaveBeenCalledWith(expect.any(Function), NOOP_CONTROL);
  });

  it('skips a paused platform before probing it (no auth request, gate untouched)', async () => {
    const probeReady = vi.fn(async () => true);
    const { deps, started } = makeDeps({
      isPaused: (jobPlatform) => jobPlatform === 'bilibili',
    });
    render(
      [
        platform({ jobPlatform: 'bilibili', itemPlatform: 'bilibili', probeReady }),
        platform({ jobPlatform: 'github-stars', itemPlatform: 'github' }),
      ],
      deps,
    );
    await flush();

    expect(probeReady).not.toHaveBeenCalled();
    expect(started.map((j) => j.jobPlatform)).toEqual(['github-stars']);
  });

  it('does not dispatch when probeReady is false', async () => {
    const { deps, started } = makeDeps();
    render(
      [platform({ jobPlatform: 'x-bookmarks', itemPlatform: 'x', probeReady: async () => false })],
      deps,
    );
    await flush();
    expect(started).toHaveLength(0);
  });

  it('swallows a silent (logged-out) error without failing the job', async () => {
    class LoggedOut extends Error {}
    const { deps, started } = makeDeps();
    render(
      [
        platform({
          jobPlatform: 'zhihu-favorites',
          itemPlatform: 'zhihu',
          runSync: async () => { throw new LoggedOut('nope'); },
          isSilentError: (err) => err instanceof LoggedOut,
        }),
      ],
      deps,
    );
    await flush();
    expect(started).toHaveLength(1);
    expect(started[0].rejected).toBe(false);
  });

  it('rethrows a non-silent error so the job is marked failed', async () => {
    const { deps, started } = makeDeps();
    render(
      [
        platform({
          jobPlatform: 'github-stars',
          itemPlatform: 'github',
          runSync: async () => { throw new Error('boom'); },
        }),
      ],
      deps,
    );
    await flush();
    expect(started).toHaveLength(1);
    expect(started[0].rejected).toBe(true);
  });

  it('isolates a platform whose probe throws (others still evaluated)', async () => {
    const { deps, started } = makeDeps();
    render(
      [
        platform({
          jobPlatform: 'x-bookmarks',
          itemPlatform: 'x',
          probeReady: async () => { throw new Error('probe blew up'); },
        }),
        platform({ jobPlatform: 'github-stars', itemPlatform: 'github' }),
      ],
      deps,
    );
    await flush();
    expect(started.map((j) => j.jobPlatform)).toEqual(['github-stars']);
  });

  it('re-evaluates when the tab becomes visible again (past the throttle)', async () => {
    const getLastAttempt = vi.fn(async () => null);
    const { deps, setNow } = makeDeps({ getLastAttempt });
    render([platform({ jobPlatform: 'bookmarks', itemPlatform: 'bookmarks' })], deps);
    await flush();
    expect(getLastAttempt).toHaveBeenCalledTimes(1);

    setNow(new Date(2026, 6, 26, 10, 1, 0)); // +60s > throttle
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(getLastAttempt).toHaveBeenCalledTimes(2);
  });

  it('throttles a second evaluation within the throttle window', async () => {
    const getLastAttempt = vi.fn(async () => null);
    const { deps, setNow } = makeDeps({ getLastAttempt });
    render([platform({ jobPlatform: 'bookmarks', itemPlatform: 'bookmarks' })], deps);
    await flush();
    expect(getLastAttempt).toHaveBeenCalledTimes(1);

    setNow(new Date(2026, 6, 26, 10, 0, EVALUATE_THROTTLE_MS / 1000 - 1)); // within window
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(getLastAttempt).toHaveBeenCalledTimes(1);
  });

  describe('once per local day, judged by the latest attempt (docs/32 D2)', () => {
    const LATER_TODAY = new Date(2026, 6, 26, 10, 1, 0); // +60s > throttle

    async function returnToTab(setNow: (d: Date) => void, at: Date): Promise<void> {
      setNow(at);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await flush();
    }

    it('does not retry a platform whose attempt failed earlier today', async () => {
      const clock = createClock();
      const store = recordStore(clock);
      const { deps, started, setNow } = makeDeps({ getLastAttempt: store.getLastAttempt }, clock);
      render(
        [
          funnelPlatform('github', 'github-stars', store.funnelDeps, async () => {
            throw new Error('rate limited');
          }),
        ],
        deps,
      );
      await flush();
      expect(started).toHaveLength(1);
      expect(started[0].rejected).toBe(true);
      expect(store.records.get('github')?.lastResult).toBe('failure');

      await returnToTab(setNow, LATER_TODAY);
      expect(started).toHaveLength(1);
    });

    it('does not re-run a platform whose sync found nothing earlier today', async () => {
      const clock = createClock();
      const store = recordStore(clock);
      const { deps, started, setNow } = makeDeps({ getLastAttempt: store.getLastAttempt }, clock);
      render(
        [
          funnelPlatform('youtube', 'youtube-playlists', store.funnelDeps, async () => ({
            fetched: 0,
            inserted: 0,
            newItemIds: [],
          })),
        ],
        deps,
      );
      await flush();
      expect(started).toHaveLength(1);
      expect(store.records.get('youtube')?.lastResult).toBe('success');

      await returnToTab(setNow, LATER_TODAY);
      expect(started).toHaveLength(1);
    });

    it('does not retry a platform whose logged-out error was silenced earlier today', async () => {
      class LoggedOut extends Error {}
      const clock = createClock();
      const store = recordStore(clock);
      const { deps, started, setNow } = makeDeps({ getLastAttempt: store.getLastAttempt }, clock);
      render(
        [
          funnelPlatform(
            'zhihu',
            'zhihu-favorites',
            store.funnelDeps,
            async () => {
              throw new LoggedOut('not logged in');
            },
            { isSilentError: (err) => err instanceof LoggedOut },
          ),
        ],
        deps,
      );
      await flush();
      expect(started).toHaveLength(1);
      // Silent is presentation only: the job completes, the record says failure.
      expect(started[0].rejected).toBe(false);
      expect(store.records.get('zhihu')?.lastResult).toBe('failure');

      await returnToTab(setNow, LATER_TODAY);
      expect(started).toHaveLength(1);
    });

    it('tries again on the next local day after a failed attempt', async () => {
      const clock = createClock();
      const store = recordStore(clock);
      store.records.set('zhihu', {
        lastAttemptAt: new Date(2026, 6, 25, 23, 58, 0),
        lastResult: 'failure',
      });
      const { deps, started } = makeDeps({ getLastAttempt: store.getLastAttempt }, clock);
      render(
        [
          funnelPlatform('zhihu', 'zhihu-favorites', store.funnelDeps, async () => ({
            fetched: 3,
            inserted: 1,
            newItemIds: ['z1'],
          })),
        ],
        deps,
      );
      await flush();

      expect(started).toHaveLength(1);
      expect(store.getLastAttempt).toHaveBeenCalledWith('zhihu');
      expect(store.records.get('zhihu')).toEqual({
        lastAttemptAt: clock.now(),
        lastResult: 'success',
      });
    });
  });
});
