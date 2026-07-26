import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoTranscribeState } from '@/lib/auto-transcribe/types';

// The runtime builds a module-level pipeline singleton; stub the pipeline and
// its bilibili collaborators so the tests drive dispatch/filter/quota-break
// behavior only. The background-jobs store stays REAL — dispatching through it
// is part of the contract under test (born-paused etc. are its own tests).
const mocks = vi.hoisted(() => ({
  isActive: vi.fn<() => boolean>(() => false),
  start: vi.fn<(collectionId: string, control?: unknown) => Promise<void>>(
    async () => undefined,
  ),
  getSnapshot: vi.fn<() => Partial<AutoTranscribeState>>(),
  subscribe: vi.fn(() => () => undefined),
  initDbProxy: vi.fn(async () => ({})),
  listFoldersWithPending: vi.fn<(ids: readonly string[]) => Promise<string[]>>(),
}));

vi.mock('@/lib/auto-transcribe/pipeline', () => ({
  AutoTranscribePipeline: class {
    isActive = mocks.isActive;
    start = mocks.start;
    getSnapshot = mocks.getSnapshot;
    subscribe = mocks.subscribe;
  },
}));
vi.mock('@/lib/bilibili/auto-transcribe-adapter', () => ({
  createBiliAutoTranscribeAdapter: vi.fn(() => ({})),
}));
vi.mock('./bilibili-processing-adapter', () => ({
  enqueueBiliCollectionProcessing: vi.fn(),
}));
vi.mock('@/lib/database', () => ({ initDbProxy: mocks.initDbProxy }));
vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  listFoldersWithPending: mocks.listFoldersWithPending,
}));

import { startBiliAutoTranscribe } from './auto-transcribe-runtime';
import { getJob } from '../../hooks/background-jobs-store';

function snapshot(phase: AutoTranscribeState['phase']): Partial<AutoTranscribeState> {
  return { phase, totalVideos: 0, currentIndex: 0 };
}

/** Let the internal async dispatch (init → filter → job runner) settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('startBiliAutoTranscribe', () => {
  beforeEach(() => {
    mocks.isActive.mockReset().mockReturnValue(false);
    mocks.start.mockReset().mockResolvedValue(undefined);
    mocks.getSnapshot.mockReset().mockReturnValue(snapshot('done'));
    mocks.subscribe.mockReset().mockReturnValue(() => undefined);
    mocks.initDbProxy.mockReset().mockResolvedValue({});
    mocks.listFoldersWithPending.mockReset().mockImplementation(async (ids) => [...ids]);
  });

  afterEach(async () => {
    // Never leave a run in flight across tests (shared module-level job store).
    await flush();
  });

  // NOTE: the "no job" assertions run before any test that creates the
  // bilibili:transcribe job — the job store is a module singleton.
  it('dispatches no job when no folder has pending videos', async () => {
    mocks.listFoldersWithPending.mockResolvedValue([]);

    startBiliAutoTranscribe(['1', '2']);
    await flush();

    expect(mocks.listFoldersWithPending).toHaveBeenCalledWith(['1', '2']);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(getJob('bilibili', 'transcribe')).toBeNull();
  });

  it('logs and dispatches nothing when the pending lookup fails', async () => {
    mocks.listFoldersWithPending.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    startBiliAutoTranscribe(['1']);
    await flush();

    expect(mocks.start).not.toHaveBeenCalled();
    expect(getJob('bilibili', 'transcribe')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is a no-op while the pipeline is already active', async () => {
    mocks.isActive.mockReturnValue(true);

    startBiliAutoTranscribe(['1']);
    await flush();

    expect(mocks.listFoldersWithPending).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('filters folders and runs the survivors serially, in order, with the checkpoint', async () => {
    mocks.listFoldersWithPending.mockResolvedValue(['2', '3']);
    const order: string[] = [];
    mocks.start.mockImplementation(async (collectionId) => {
      order.push(collectionId);
    });

    startBiliAutoTranscribe(['1', '2', '3']);
    await flush();

    expect(order).toEqual(['2', '3']);
    for (const call of mocks.start.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ checkpoint: expect.any(Function) }));
    }
    expect(getJob('bilibili', 'transcribe')?.phase).toBe('completed');
  });

  it('stops the remaining folders when a run ends quota_paused', async () => {
    mocks.listFoldersWithPending.mockResolvedValue(['1', '2', '3']);
    mocks.getSnapshot.mockReturnValue(snapshot('quota_paused'));

    startBiliAutoTranscribe(['1', '2', '3']);
    await flush();

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith('1', expect.anything());
  });

  it('stops the remaining folders when a run ends cancelled', async () => {
    mocks.listFoldersWithPending.mockResolvedValue(['1', '2']);
    mocks.getSnapshot.mockReturnValue(snapshot('cancelled'));

    startBiliAutoTranscribe(['1', '2']);
    await flush();

    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
