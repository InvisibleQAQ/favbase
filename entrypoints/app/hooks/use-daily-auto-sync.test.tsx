// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keep the hook module self-contained: stub the heavy registry + lib barrels so
// importing the hook never pulls chrome/AI deps. Fake platforms are injected per
// test, so the real AUTO_SYNC_PLATFORMS export is unused.
vi.mock('./auto-sync-registry', () => ({ AUTO_SYNC_PLATFORMS: [] }));
vi.mock('./background-jobs-store', () => ({ startJob: vi.fn() }));
vi.mock('./library-gate', () => ({ isLibraryPaused: () => false }));
vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(), getDb: vi.fn() }));
vi.mock('@/lib/database/collection-queries', () => ({ getPlatformLastSyncedAt: vi.fn() }));

import type { AutoSyncPlatform } from './auto-sync-registry';
import { EVALUATE_THROTTLE_MS, useDailyAutoSync, type DailyAutoSyncDeps } from './use-daily-auto-sync';

const NOOP_CONTROL: CooperativeCheckpoint = { checkpoint: async () => {} };

/** Run a runner captured by the mock startJob and report if it rejected. */
interface StartedJob {
  jobPlatform: string;
  runner: (setProgress: (p: unknown) => void, control: CooperativeCheckpoint) => Promise<void>;
  rejected: boolean;
}

function makeDeps(overrides: Partial<DailyAutoSyncDeps> = {}): {
  deps: DailyAutoSyncDeps;
  started: StartedJob[];
  setNow: (d: Date) => void;
} {
  const started: StartedJob[] = [];
  let current = new Date(2026, 6, 26, 10, 0, 0);

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
    now: () => current,
    getLastSynced: vi.fn(async () => null),
    isPaused: () => false,
    startJob,
    ...overrides,
  };

  return { deps, started, setNow: (d) => { current = d; } };
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

  it('skips a platform already synced today (gate not hit)', async () => {
    const { deps, started } = makeDeps({
      getLastSynced: vi.fn(async () => new Date(2026, 6, 26, 2, 0, 0)),
    });
    render([platform({ jobPlatform: 'github-stars', itemPlatform: 'github' })], deps);
    await flush();
    expect(started).toHaveLength(0);
  });

  it('dispatches the shared Sync Adapter for a ready, not-today platform', async () => {
    const runSync = vi.fn(async () => undefined);
    const { deps, started } = makeDeps({
      getLastSynced: vi.fn(async () => new Date(2026, 6, 25, 10, 0, 0)),
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
    const getLastSynced = vi.fn(async () => null);
    const { deps, setNow } = makeDeps({ getLastSynced });
    render([platform({ jobPlatform: 'bookmarks', itemPlatform: 'bookmarks' })], deps);
    await flush();
    expect(getLastSynced).toHaveBeenCalledTimes(1);

    setNow(new Date(2026, 6, 26, 10, 1, 0)); // +60s > throttle
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(getLastSynced).toHaveBeenCalledTimes(2);
  });

  it('throttles a second evaluation within the throttle window', async () => {
    const getLastSynced = vi.fn(async () => null);
    const { deps, setNow } = makeDeps({ getLastSynced });
    render([platform({ jobPlatform: 'bookmarks', itemPlatform: 'bookmarks' })], deps);
    await flush();
    expect(getLastSynced).toHaveBeenCalledTimes(1);

    setNow(new Date(2026, 6, 26, 10, 0, EVALUATE_THROTTLE_MS / 1000 - 1)); // within window
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(getLastSynced).toHaveBeenCalledTimes(1);
  });
});
