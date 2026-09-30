import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

// The real dispatcher pulls the embedding/tagging barrels (chrome.storage at
// load); the default deps reach the DB proxy. Every test injects deps.
vi.mock('./collection-processing-jobs', () => ({ startCollectionProcessingJobs: vi.fn() }));
vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn() }));

import { runPlatformSync, type PlatformSyncDeps, type PlatformSyncOutcome } from './platform-sync';

const NOW = new Date(2026, 8, 30, 10, 0, 0);
const OUTCOME: PlatformSyncOutcome = { fetched: 55, inserted: 2, newItemIds: ['a', 'b'] };
const OPEN: CooperativeCheckpoint = { checkpoint: async () => undefined };

function makeDeps(calls: string[], overrides: Partial<PlatformSyncDeps> = {}): PlatformSyncDeps {
  return {
    now: () => NOW,
    recordAttempt: vi.fn(async () => {
      calls.push('attempt');
    }),
    recordSuccess: vi.fn(async () => {
      calls.push('success');
    }),
    recordFailure: vi.fn(async () => {
      calls.push('failure');
    }),
    dispatch: vi.fn(() => {
      calls.push('dispatch');
    }),
    ...overrides,
  };
}

describe('runPlatformSync (the Platform Sync funnel)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the attempt, syncs, dispatches, then records the success — in that order', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const control: CooperativeCheckpoint = {
      checkpoint: async () => {
        calls.push('checkpoint');
      },
    };

    await runPlatformSync('github', control, async () => {
      calls.push('sync');
      return OUTCOME;
    }, deps);

    expect(calls).toEqual(['checkpoint', 'attempt', 'sync', 'dispatch', 'success']);
    expect(deps.recordAttempt).toHaveBeenCalledWith('github', NOW);
    // The job namespace is derived from the Collection discriminator.
    expect(deps.dispatch).toHaveBeenCalledWith({
      jobPlatform: 'github-stars',
      itemPlatform: 'github',
      itemIds: ['a', 'b'],
    });
    expect(deps.recordSuccess).toHaveBeenCalledWith('github', {
      at: NOW,
      fetched: 55,
      inserted: 2,
    });
  });

  it('a failed sync records the failure, dispatches nothing and rethrows the original error', async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const boom = new Error('rate limited');

    await expect(
      runPlatformSync('zhihu', OPEN, async () => {
        throw boom;
      }, deps),
    ).rejects.toBe(boom);

    expect(calls).toEqual(['attempt', 'failure']);
    expect(deps.recordFailure).toHaveBeenCalledWith('zhihu');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.recordSuccess).not.toHaveBeenCalled();
  });

  it('a failing failure-write never masks the sync error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('403 anti-crawler');
    const deps = makeDeps([], {
      recordFailure: vi.fn(async () => {
        throw new Error('db gone');
      }),
    });

    await expect(
      runPlatformSync('zhihu', OPEN, async () => {
        throw boom;
      }, deps),
    ).rejects.toBe(boom);
  });

  it('a failed attempt-write stops before contacting the platform', async () => {
    const sync = vi.fn(async () => OUTCOME);
    const deps = makeDeps([], {
      recordAttempt: vi.fn(async () => {
        throw new Error('db gone');
      }),
    });

    await expect(runPlatformSync('x', OPEN, sync, deps)).rejects.toThrow('db gone');
    expect(sync).not.toHaveBeenCalled();
    expect(deps.recordFailure).not.toHaveBeenCalled();
  });

  it('a paused run records no attempt until it is resumed', async () => {
    let resume!: () => void;
    const paused: CooperativeCheckpoint = {
      checkpoint: () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    };
    const deps = makeDeps([]);

    const run = runPlatformSync('bilibili', paused, async () => OUTCOME, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.recordAttempt).not.toHaveBeenCalled();

    resume();
    await run;
    expect(deps.recordAttempt).toHaveBeenCalledTimes(1);
  });

  it('a failed success-write fails the run after the lanes were dispatched', async () => {
    const deps = makeDeps([], {
      recordSuccess: vi.fn(async () => {
        throw new Error('db gone');
      }),
    });

    await expect(runPlatformSync('youtube', OPEN, async () => OUTCOME, deps)).rejects.toThrow(
      'db gone',
    );
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.recordFailure).not.toHaveBeenCalled();
  });
});
