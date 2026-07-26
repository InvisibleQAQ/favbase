import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  startJob,
  trackJobRun,
  getJob,
  getRunningJobCount,
  pauseJob,
  resumeJob,
  setJobGate,
  type BackgroundJobKind,
} from './background-jobs-store';

/** A resolvable/rejectable promise for driving a runner's lifecycle in tests. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks/macrotasks so the store's async transitions settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

// Distinct platform per test → no cross-test module-state collision (the store
// is a module singleton; there is intentionally no reset export).
describe('backgroundJobs store', () => {
  it('dedupes: a second start while running is a no-op (cross-mount guard)', async () => {
    const gate = deferred();
    const second = vi.fn(async () => {});

    startJob('p-dedupe', 'sync', () => gate.promise);
    expect(getJob('p-dedupe', 'sync')?.running).toBe(true);
    expect(getRunningJobCount()).toBe(1);

    startJob('p-dedupe', 'sync', second);
    expect(second).not.toHaveBeenCalled();
    expect(getRunningJobCount()).toBe(1);

    gate.resolve();
    await flush();
    expect(getJob('p-dedupe', 'sync')?.running).toBe(false);
  });

  it('bumps generation on each successful completion and clears progress', async () => {
    startJob('p-gen', 'sync', async () => {});
    await flush();
    let job = getJob('p-gen', 'sync');
    expect(job?.running).toBe(false);
    expect(job?.generation).toBe(1);
    expect(job?.progress).toBeNull();

    startJob('p-gen', 'sync', async () => {});
    await flush();
    job = getJob('p-gen', 'sync');
    expect(job?.generation).toBe(2);
  });

  it('retains the last successful progress separately from active progress', async () => {
    startJob('p-summary', 'sync', async (setProgress) => {
      setProgress({ done: 7, total: null });
    });
    await flush();

    expect(getJob('p-summary', 'sync')).toMatchObject({
      phase: 'completed',
      progress: null,
      lastProgress: { done: 7, total: null },
    });
  });

  it('forwards progress from the runner while running', async () => {
    const gate = deferred();
    startJob('p-prog', 'embed', async (setProgress) => {
      setProgress({ done: 3, total: 10 });
      await gate.promise;
    });
    expect(getJob('p-prog', 'embed')?.progress).toEqual({ done: 3, total: 10 });

    gate.resolve();
    await flush();
    // Progress resets to null once the job settles.
    expect(getJob('p-prog', 'embed')?.progress).toBeNull();
  });

  it('ignores stale progress callbacks from an older run', async () => {
    let reportOldProgress!: (progress: unknown) => void;
    startJob('p-owner-progress', 'sync', async (setProgress) => {
      reportOldProgress = setProgress;
    });
    await flush();

    const gate = deferred();
    startJob('p-owner-progress', 'sync', async (setProgress) => {
      setProgress({ run: 'new' });
      await gate.promise;
    });

    reportOldProgress({ run: 'old' });
    expect(getJob('p-owner-progress', 'sync')?.progress).toEqual({ run: 'new' });

    gate.resolve();
    await flush();
  });

  it('captures a thrown error and does NOT bump generation', async () => {
    startJob('p-err', 'tag', async () => {
      throw new Error('boom');
    });
    await flush();
    const job = getJob('p-err', 'tag');
    expect(job?.running).toBe(false);
    expect((job?.error as Error)?.message).toBe('boom');
    expect(job?.generation).toBe(0);
  });

  it('a new start clears the prior error but preserves generation', async () => {
    startJob('p-recover', 'sync', async () => {
      throw new Error('first');
    });
    await flush();
    expect((getJob('p-recover', 'sync')?.error as Error)?.message).toBe('first');

    startJob('p-recover', 'sync', async () => {});
    await flush();
    const job = getJob('p-recover', 'sync');
    expect(job?.error).toBeNull();
    expect(job?.generation).toBe(1);
  });

  it('counts running jobs across platforms and kinds', async () => {
    const a = deferred();
    const b = deferred();
    const before = getRunningJobCount();

    startJob('p-count-1', 'sync', () => a.promise);
    startJob('p-count-2', 'embed', () => b.promise);
    expect(getRunningJobCount()).toBe(before + 2);

    a.resolve();
    b.resolve();
    await flush();
    expect(getRunningJobCount()).toBe(before);
  });

  it('pauses at the runner checkpoint and resumes the same job', async () => {
    const reachCheckpoint = deferred();
    const finish = deferred();
    const before = getRunningJobCount();
    let continued = false;

    startJob('p-control', 'embed', async (_setProgress, control) => {
      await reachCheckpoint.promise;
      await control.checkpoint();
      continued = true;
      await finish.promise;
    });

    pauseJob('p-control', 'embed');
    expect(getJob('p-control', 'embed')?.phase).toBe('pausing');

    reachCheckpoint.resolve();
    await flush();
    expect(getJob('p-control', 'embed')?.phase).toBe('paused');
    expect(continued).toBe(false);
    expect(getRunningJobCount()).toBe(before + 1);

    resumeJob('p-control', 'embed');
    await flush();
    expect(getJob('p-control', 'embed')?.phase).toBe('running');
    expect(continued).toBe(true);

    finish.resolve();
    await flush();
    expect(getJob('p-control', 'embed')?.running).toBe(false);
    expect(getRunningJobCount()).toBe(before);
  });

  it('keeps a stable job reference until the job actually changes', async () => {
    const gate = deferred();
    startJob('p-ref', 'sync', () => gate.promise);
    const snapA = getJob('p-ref', 'sync');
    const snapB = getJob('p-ref', 'sync');
    expect(snapA).toBe(snapB); // same ref between reads → no useSyncExternalStore thrash

    gate.resolve();
    await flush();
    expect(getJob('p-ref', 'sync')).not.toBe(snapA); // settle swaps the ref
  });

  it('tracks overlapping fire-and-forget runs until the whole lane settles', async () => {
    const first = deferred();
    const second = deferred();

    trackJobRun('p-overlap', 'embed', first.promise);
    trackJobRun('p-overlap', 'embed', second.promise);
    expect(getJob('p-overlap', 'embed')?.running).toBe(true);

    first.resolve();
    await flush();
    expect(getJob('p-overlap', 'embed')?.running).toBe(true);

    second.resolve();
    await flush();
    expect(getJob('p-overlap', 'embed')).toMatchObject({
      running: false,
      generation: 1,
    });
  });

  it('retains the first tracked error until every overlapping run settles', async () => {
    const first = deferred();
    const second = deferred();
    const error = new Error('embed failed');

    trackJobRun('p-overlap-error', 'embed', first.promise);
    trackJobRun('p-overlap-error', 'embed', second.promise);

    first.reject(error);
    await flush();
    expect(getJob('p-overlap-error', 'embed')?.running).toBe(true);

    second.resolve();
    await flush();
    expect(getJob('p-overlap-error', 'embed')).toMatchObject({
      running: false,
      error,
      generation: 0,
    });
  });
});

describe('backgroundJobs library gate', () => {
  afterEach(() => {
    setJobGate(null);
  });

  it('starts a gated run born-paused instead of refusing (no dropped work)', async () => {
    setJobGate((platform) => platform === 'p-gated');
    const finish = deferred();
    const steps: string[] = [];

    const handle = startJob('p-gated', 'sync', async (_setProgress, control) => {
      await control.checkpoint();
      steps.push('worked');
      await finish.promise;
    });
    await flush();

    // started:true is the contract — startBatchLane/wakeLane retry forever on false.
    expect(handle.started).toBe(true);
    expect(getJob('p-gated', 'sync')).toMatchObject({ phase: 'paused', running: true });
    expect(steps).toEqual([]);

    resumeJob('p-gated', 'sync');
    await flush();
    expect(getJob('p-gated', 'sync')?.phase).toBe('running');
    expect(steps).toEqual(['worked']);

    finish.resolve();
    await flush();
    expect(getJob('p-gated', 'sync')).toMatchObject({ phase: 'completed', generation: 1 });
  });

  it('leaves other platforms running while one is gated', async () => {
    setJobGate((platform) => platform === 'p-gate-mine');
    const gate = deferred();

    startJob('p-gate-mine', 'embed', async (_setProgress, control) => {
      await control.checkpoint();
      await gate.promise;
    });
    startJob('p-gate-other', 'embed', async (_setProgress, control) => {
      await control.checkpoint();
    });
    await flush();

    expect(getJob('p-gate-mine', 'embed')?.phase).toBe('paused');
    expect(getJob('p-gate-other', 'embed')?.phase).toBe('completed');

    gate.resolve();
    resumeJob('p-gate-mine', 'embed');
    await flush();
    expect(getJob('p-gate-mine', 'embed')?.phase).toBe('completed');
  });

  it('never lets a throwing gate take dispatch down', async () => {
    setJobGate(() => {
      throw new Error('gate exploded');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      startJob('p-gate-throws', 'sync', async () => {});
      await flush();
      expect(getJob('p-gate-throws', 'sync')).toMatchObject({
        phase: 'completed',
        generation: 1,
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// Type-only guard: kind union is closed to the five known kinds.
const _kinds: BackgroundJobKind[] = ['sync', 'extract', 'embed', 'tag', 'transcribe'];
void _kinds;
