import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DouyinPendingVideo, SyncDouyinOptions } from '@/lib/douyin/douyin-sync-service';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  close: vi.fn(),
  run: vi.fn(),
  finishSession: null as (() => void) | null,
  sessionClosed: false,
  createSession: vi.fn(),
  getSnapshot: vi.fn(() => ({ totalVideos: 0, currentIndex: 0 })),
  isActive: vi.fn(() => false),
  subscribe: vi.fn(() => () => undefined),
  syncDouyinCollections: vi.fn(),
  getDouyinPendingVideos: vi.fn(),
  transport: vi.fn(),
}));

vi.mock('@/lib/auto-transcribe/pipeline', () => ({
  AutoTranscribePipeline: class {
    createSession = mocks.createSession;
    getSnapshot = mocks.getSnapshot;
    subscribe = mocks.subscribe;
    isActive = mocks.isActive;
  },
}));
vi.mock('@/lib/douyin/auto-transcribe-adapter', () => ({
  createDouyinAutoTranscribeAdapter: vi.fn(() => ({})),
}));
vi.mock('@/lib/douyin/douyin-sync-service', () => ({
  syncDouyinCollections: mocks.syncDouyinCollections,
  getDouyinPendingVideos: mocks.getDouyinPendingVideos,
}));
vi.mock('./douyin-processing-adapter', () => ({
  enqueueDouyinCollectionProcessing: vi.fn(),
}));

import { runDouyinStreamingSync } from './auto-transcribe-runtime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function pending(awemeId: string, durationMs: number | null = 61_400): DouyinPendingVideo {
  return { awemeId, title: `title ${awemeId}`, coverUrl: null, authorName: 'Alice', durationMs };
}

const RESULT = { fetched: 2, inserted: 2, folders: 0, newItemIds: [] };
const OPTS = { backfill: { resumeCursor: null, backfillDone: false } };

describe('runDouyinStreamingSync', () => {
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
    mocks.syncDouyinCollections.mockReset();
    mocks.getDouyinPendingVideos.mockReset().mockResolvedValue([]);
    mocks.isActive.mockReset().mockReturnValue(false);
  });

  it("publishes each page's pending videos into the inbox in the auto-transcribe shape, then the stored backlog after the sync succeeded (D7)", async () => {
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      opts.onVideosPending?.([pending('1'), pending('2', null)]);
      return RESULT;
    });
    mocks.getDouyinPendingVideos.mockResolvedValue([pending('old-1')]);

    await expect(runDouyinStreamingSync(mocks.transport, OPTS)).resolves.toBe(RESULT);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    expect(mocks.syncDouyinCollections).toHaveBeenCalledWith(mocks.transport, expect.objectContaining(OPTS));
    expect(mocks.append.mock.calls).toEqual([
      [[
        { videoId: '1', title: 'title 1', cover: '', author: 'Alice', duration: 61 },
        { videoId: '2', title: 'title 2', cover: '', author: 'Alice', duration: 0 },
      ]],
      [[{ videoId: 'old-1', title: 'title old-1', cover: '', author: 'Alice', duration: 61 }]],
    ]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('skips the backlog when an earlier session is still draining at sync start, judged at entry: the per-page videos still go in', async () => {
    // Active at entry; the earlier session finishes while this sync pages, so
    // a check after the sync would (wrongly) see no session and read a list
    // that goes stale behind the session it is queued after.
    mocks.isActive.mockReturnValue(true);
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      mocks.isActive.mockReturnValue(false);
      opts.onVideosPending?.([pending('1')]);
      return RESULT;
    });
    mocks.getDouyinPendingVideos.mockResolvedValue([pending('old-1')]);

    await expect(runDouyinStreamingSync(mocks.transport, OPTS)).resolves.toBe(RESULT);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    expect(mocks.getDouyinPendingVideos).not.toHaveBeenCalled();
    expect(mocks.append.mock.calls).toEqual([
      [[{ videoId: '1', title: 'title 1', cover: '', author: 'Alice', duration: 61 }]],
    ]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('a failed sync skips the backlog pass, closes the producer so what was published drains, and rethrows', async () => {
    const failure = new Error('page 3 failed');
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      opts.onVideosPending?.([pending('1')]);
      throw failure;
    });

    await expect(runDouyinStreamingSync(mocks.transport, OPTS)).rejects.toBe(failure);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    expect(mocks.getDouyinPendingVideos).not.toHaveBeenCalled();
    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('Fetch never awaits Transcript: the sync settles while the session is still running', async () => {
    // A session that never finishes: were Fetch to wait for it, this would hang.
    mocks.run.mockImplementation(() => new Promise<void>(() => undefined));
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      opts.onVideosPending?.([pending('1')]);
      return RESULT;
    });

    await expect(runDouyinStreamingSync(mocks.transport, OPTS)).resolves.toBe(RESULT);

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('a backlog read that fails does not turn a successful sync into a failed one', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.syncDouyinCollections.mockResolvedValue(RESULT);
    mocks.getDouyinPendingVideos.mockRejectedValue(new Error('db gone'));

    await expect(runDouyinStreamingSync(mocks.transport, OPTS)).resolves.toBe(RESULT);

    expect(consoleError).toHaveBeenCalledOnce();
    expect(mocks.createSession).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('a sync that inserts nothing and finds no backlog starts no session', async () => {
    mocks.syncDouyinCollections.mockResolvedValue(RESULT);

    await runDouyinStreamingSync(mocks.transport, OPTS);
    await Promise.resolve();

    expect(mocks.getDouyinPendingVideos).toHaveBeenCalledOnce();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
