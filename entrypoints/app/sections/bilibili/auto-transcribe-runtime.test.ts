import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder, BiliFavVideo } from '@/lib/bilibili/types';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  close: vi.fn(),
  run: vi.fn(),
  finishSession: null as (() => void) | null,
  sessionClosed: false,
  createSession: vi.fn(),
  getSnapshot: vi.fn(() => ({ totalVideos: 0, currentIndex: 0 })),
  subscribe: vi.fn(() => () => undefined),
  syncAllFavoriteVideos: vi.fn(),
}));

vi.mock('@/lib/auto-transcribe/pipeline', () => ({
  AutoTranscribePipeline: class {
    createSession = mocks.createSession;
    getSnapshot = mocks.getSnapshot;
    subscribe = mocks.subscribe;
  },
}));
vi.mock('@/lib/bilibili/auto-transcribe-adapter', () => ({
  createBiliAutoTranscribeAdapter: vi.fn(() => ({})),
}));
vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  syncAllFavoriteVideos: mocks.syncAllFavoriteVideos,
}));
vi.mock('./bilibili-processing-adapter', () => ({
  enqueueBiliCollectionProcessing: vi.fn(),
}));

import { runBiliStreamingSync } from './auto-transcribe-runtime';
import { startJob } from '../../hooks/background-jobs-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function folder(id: number): BiliFavFolder {
  return {
    id,
    fid: id,
    mid: 1,
    title: `folder-${id}`,
    media_count: 1,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
  };
}

function video(bvid: string): BiliFavVideo {
  return {
    id: 1,
    type: 2,
    title: bvid,
    cover: '',
    intro: '',
    duration: 60,
    bvid,
    upper: { mid: 1, name: 'UP', face: '' },
    cnt_info: { play: 0, collect: 0, danmaku: 0 },
    fav_time: 0,
    attr: 0,
  };
}

describe('runBiliStreamingSync', () => {
  beforeEach(() => {
    mocks.append.mockReset();
    mocks.sessionClosed = false;
    mocks.close.mockReset().mockImplementation(() => {
      mocks.sessionClosed = true;
      mocks.finishSession?.();
    });
    mocks.run.mockReset().mockImplementation(
      () => mocks.sessionClosed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            mocks.finishSession = resolve;
          }),
    );
    mocks.finishSession = null;
    mocks.createSession.mockReset().mockReturnValue({
      append: mocks.append,
      close: mocks.close,
      run: mocks.run,
    });
    mocks.getSnapshot.mockReset().mockReturnValue({ totalVideos: 0, currentIndex: 0 });
    mocks.subscribe.mockReset().mockReturnValue(() => undefined);
    mocks.syncAllFavoriteVideos.mockReset();
  });

  it('starts one transcript run from the first persisted page while Fetch continues', async () => {
    const fetchDone = deferred<{ fetchedCount: number; syncedCount: number }>();
    let publish!: (videos: readonly BiliFavVideo[]) => void;
    mocks.syncAllFavoriteVideos.mockImplementation(
      async (_folders, _onProgress, _control, onItemsPersisted) => {
        publish = onItemsPersisted;
        return fetchDone.promise;
      },
    );

    let settled = false;
    const fetch = runBiliStreamingSync([folder(1)]).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.syncAllFavoriteVideos).toHaveBeenCalledOnce());

    publish([video('BV-1')]);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    publish([video('BV-2')]);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.append).toHaveBeenCalledTimes(2);

    fetchDone.resolve({ fetchedCount: 2, syncedCount: 2 });
    await expect(fetch).resolves.toEqual({ fetchedCount: 2, syncedCount: 2 });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('closes the producer on Fetch failure so already-published items drain', async () => {
    const fetchError = new Error('page 2 failed');
    mocks.syncAllFavoriteVideos.mockImplementation(
      async (_folders, _onProgress, _control, onItemsPersisted) => {
        onItemsPersisted([video('BV-SAVED')]);
        throw fetchError;
      },
    );

    await expect(runBiliStreamingSync([folder(1)])).rejects.toBe(fetchError);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('retains the stream while a manual transcription owns the job key', async () => {
    const manual = deferred<void>();
    const manualJob = startJob('bilibili', 'transcribe', () => manual.promise);
    mocks.syncAllFavoriteVideos.mockImplementation(
      async (_folders, _onProgress, _control, onItemsPersisted) => {
        onItemsPersisted([video('BV-AFTER-MANUAL')]);
        return { fetchedCount: 1, syncedCount: 1 };
      },
    );

    await runBiliStreamingSync([folder(1)]);
    await Promise.resolve();
    expect(mocks.run).not.toHaveBeenCalled();

    manual.resolve();
    await manualJob.settled;
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(mocks.append).toHaveBeenCalledOnce();
  });

  it('serializes a later Fetch producer behind the active Transcript session', async () => {
    const firstDrain = deferred<void>();
    const firstSession = {
      append: vi.fn(),
      close: vi.fn(),
      run: vi.fn(() => firstDrain.promise),
    };
    const secondSession = {
      append: vi.fn(),
      close: vi.fn(),
      run: vi.fn(async () => undefined),
    };
    mocks.createSession
      .mockReset()
      .mockReturnValueOnce(firstSession)
      .mockReturnValueOnce(secondSession);
    mocks.syncAllFavoriteVideos
      .mockImplementationOnce(
        async (_folders, _onProgress, _control, onItemsPersisted) => {
          onItemsPersisted([video('BV-FIRST-FETCH')]);
          return { fetchedCount: 1, syncedCount: 1 };
        },
      )
      .mockImplementationOnce(
        async (_folders, _onProgress, _control, onItemsPersisted) => {
          onItemsPersisted([video('BV-SECOND-FETCH')]);
          return { fetchedCount: 1, syncedCount: 1 };
        },
      );

    await runBiliStreamingSync([folder(1)]);
    await vi.waitFor(() => expect(firstSession.run).toHaveBeenCalledOnce());

    await runBiliStreamingSync([folder(2)]);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(secondSession.run).not.toHaveBeenCalled();

    firstDrain.resolve();
    await vi.waitFor(() => expect(secondSession.run).toHaveBeenCalledOnce());

    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.append).toHaveBeenCalledOnce();
    expect(secondSession.append).toHaveBeenCalledOnce();
    expect(firstSession.close).toHaveBeenCalledOnce();
    expect(secondSession.close).toHaveBeenCalledOnce();
  });
});
