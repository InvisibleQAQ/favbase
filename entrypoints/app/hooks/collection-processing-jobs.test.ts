import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
}));

import { getJob, pauseJob, resumeJob, setJobGate } from './background-jobs-store';
import {
  enqueueCollectionProcessingItem,
  startCollectionProcessingJobs,
} from './collection-processing-jobs';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('collection processing jobs', () => {
  it('drains items enqueued while the session lane is already running', async () => {
    const releaseFirstEmbed = deferred();
    const embedded: string[] = [];
    const tagged: string[] = [];
    const deps = {
      embed: async (_platform: string, itemId: string) => {
        embedded.push(itemId);
        if (itemId === 'a') await releaseFirstEmbed.promise;
        return 'embedded' as const;
      },
      tag: async (_platform: string, itemId: string) => {
        tagged.push(itemId);
        return 'tagged' as const;
      },
    };

    const first = enqueueCollectionProcessingItem(
      { jobPlatform: 'p-stream', itemPlatform: 'x', itemId: 'a' },
      deps,
    );
    await flush();
    const second = enqueueCollectionProcessingItem(
      { jobPlatform: 'p-stream', itemPlatform: 'x', itemId: 'b' },
      deps,
    );
    releaseFirstEmbed.resolve();

    await Promise.all([first.embed, first.tag, second.embed, second.tag]);

    expect(embedded).toEqual(['a', 'b']);
    expect(tagged).toEqual(['a', 'b']);
  });

  it('observes rejected tickets when a streaming caller intentionally ignores them', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      enqueueCollectionProcessingItem(
        { jobPlatform: 'p-ignored-ticket', itemPlatform: 'x', itemId: 'a' },
        {
          embed: async () => {
            throw new Error('embedding unavailable');
          },
          tag: async () => 'tagged',
        },
      );

      await flush();
      await flush();

      expect(getJob('p-ignored-ticket', 'embed')?.phase).toBe('failed');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('runs independently controllable Embed and Tags lanes', async () => {
    const reachTagCheckpoint = deferred();
    let tagContinued = false;

    startCollectionProcessingJobs(
      { jobPlatform: 'p-processing', itemPlatform: 'x', itemIds: ['a', 'b'] },
      {
        embed: async () => {},
        tag: async (_platform, _ids, _onProgress, control) => {
          await reachTagCheckpoint.promise;
          await control.checkpoint();
          tagContinued = true;
        },
      },
    );

    pauseJob('p-processing', 'tag');
    reachTagCheckpoint.resolve();
    await flush();

    expect(getJob('p-processing', 'embed')?.phase).toBe('completed');
    expect(getJob('p-processing', 'tag')?.phase).toBe('paused');
    expect(tagContinued).toBe(false);

    resumeJob('p-processing', 'tag');
    await flush();

    expect(tagContinued).toBe(true);
    expect(getJob('p-processing', 'tag')?.phase).toBe('completed');
  });

  it('runs a later batch after the active lane settles instead of dropping it', async () => {
    const releaseFirst = deferred();
    const calls: string[] = [];
    const firstDeps = {
      embed: async () => {
        calls.push('embed:a');
        await releaseFirst.promise;
      },
      tag: async () => {
        calls.push('tag:a');
        await releaseFirst.promise;
      },
    };
    const secondDeps = {
      embed: async () => {
        calls.push('embed:b');
      },
      tag: async () => {
        calls.push('tag:b');
      },
    };

    startCollectionProcessingJobs(
      { jobPlatform: 'p-batches', itemPlatform: 'x', itemIds: ['a'] },
      firstDeps,
    );
    startCollectionProcessingJobs(
      { jobPlatform: 'p-batches', itemPlatform: 'x', itemIds: ['b'] },
      secondDeps,
    );
    await flush();

    expect(calls).toEqual(['embed:a', 'tag:a']);

    releaseFirst.resolve();
    await flush();
    await flush();

    expect(calls).toEqual(['embed:a', 'tag:a', 'embed:b', 'tag:b']);
  });

  it('holds a gated batch born-paused and resumes it without losing the batch', async () => {
    setJobGate((platform) => platform === 'p-gated-batch');
    try {
      const calls: string[] = [];
      const deps = {
        embed: async (
          _platform: string,
          ids: string[],
          _onProgress: (p: { done: number; total: number }) => void,
          control: { checkpoint: () => Promise<void> },
        ) => {
          await control.checkpoint();
          calls.push(`embed:${ids.join(',')}`);
        },
        tag: async (
          _platform: string,
          ids: string[],
          _onProgress: (p: { done: number; total: number }) => void,
          control: { checkpoint: () => Promise<void> },
        ) => {
          await control.checkpoint();
          calls.push(`tag:${ids.join(',')}`);
        },
      };

      startCollectionProcessingJobs(
        { jobPlatform: 'p-gated-batch', itemPlatform: 'x', itemIds: ['a', 'b'] },
        deps,
      );
      await flush();
      await flush();

      // Born paused, NOT refused — a refused start would spin startBatchLane's
      // "retry after settlement" path.
      expect(getJob('p-gated-batch', 'embed')?.phase).toBe('paused');
      expect(getJob('p-gated-batch', 'tag')?.phase).toBe('paused');
      expect(calls).toEqual([]);

      setJobGate(null);
      resumeJob('p-gated-batch', 'embed');
      resumeJob('p-gated-batch', 'tag');
      await flush();

      expect(calls.sort()).toEqual(['embed:a,b', 'tag:a,b']);
      expect(getJob('p-gated-batch', 'embed')?.phase).toBe('completed');
    } finally {
      setJobGate(null);
    }
  });

  it('holds a gated streaming lane and drains its inbox after resume', async () => {
    setJobGate((platform) => platform === 'p-gated-stream');
    try {
      const embedded: string[] = [];
      const deps = {
        embed: async (_platform: string, itemId: string) => {
          embedded.push(itemId);
          return 'embedded' as const;
        },
        tag: async () => 'tagged' as const,
      };

      const first = enqueueCollectionProcessingItem(
        { jobPlatform: 'p-gated-stream', itemPlatform: 'bookmarks', itemId: 'a' },
        deps,
      );
      await flush();
      // An item that arrives while the lane is gated must join the same inbox.
      const second = enqueueCollectionProcessingItem(
        { jobPlatform: 'p-gated-stream', itemPlatform: 'bookmarks', itemId: 'b' },
        deps,
      );
      await flush();

      expect(getJob('p-gated-stream', 'embed')?.phase).toBe('paused');
      expect(embedded).toEqual([]);

      setJobGate(null);
      resumeJob('p-gated-stream', 'embed');
      resumeJob('p-gated-stream', 'tag');
      await Promise.all([first.embed, first.tag, second.embed, second.tag]);

      expect(embedded).toEqual(['a', 'b']);
    } finally {
      setJobGate(null);
    }
  });
});
