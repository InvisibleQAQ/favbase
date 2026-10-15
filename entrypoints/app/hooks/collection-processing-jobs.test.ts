import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
}));

const tagging = vi.hoisted(() => ({
  tagPlatformBacklog: vi.fn(async (_platform: string) => undefined),
  tagPlatformItem: vi.fn(async () => 'tagged' as const),
}));
vi.mock('@/lib/tagging', () => tagging);
const embedding = vi.hoisted(() => ({
  embedPlatformBacklog: vi.fn(async (_platform: string) => undefined),
  embedPlatformItem: vi.fn(async () => 'embedded' as const),
}));
vi.mock('@/lib/embedding', () => embedding);

import { getJob, pauseJob, resumeJob, setJobGate } from './background-jobs-store';
import {
  enqueueCollectionProcessingItem,
  startCollectionProcessingBacklog,
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
  it('dispatches an Embedding resume to the Embed lane only', async () => {
    const embed = vi.fn().mockResolvedValue(undefined);
    const tag = vi.fn().mockResolvedValue(undefined);

    startCollectionProcessingBacklog(
      { jobPlatform: 'p-embed-resume', itemPlatform: 'github', capability: 'embedding' },
      { embed, tag },
    );
    await flush();

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toBe('github');
    expect(tag).not.toHaveBeenCalled();
    expect(getJob('p-embed-resume', 'embed')?.phase).toBe('completed');
    expect(getJob('p-embed-resume', 'tag')).toBeNull();
  });

  it('coalesces colliding Tags backlog resumes into one follow-up run', async () => {
    const releaseFirst = deferred();
    const tag = vi
      .fn()
      .mockImplementationOnce(() => releaseFirst.promise)
      .mockResolvedValue(undefined);

    for (let i = 0; i < 3; i += 1) {
      startCollectionProcessingBacklog(
        { jobPlatform: 'p-resume', itemPlatform: 'x', capability: 'llm' },
        { embed: async () => {}, tag },
      );
    }
    await flush();

    expect(tag).toHaveBeenCalledTimes(1);

    releaseFirst.resolve();
    await flush();
    await flush();

    expect(tag).toHaveBeenCalledTimes(2);
  });

  it('traces Embed batch dispatch, store-side queueing, and coalescing', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const releaseFirst = deferred();

    try {
      startCollectionProcessingJobs(
        { jobPlatform: 'p-trace-batch', itemPlatform: 'x' },
        { embed: () => releaseFirst.promise, tag: async () => {} },
      );
      startCollectionProcessingJobs(
        { jobPlatform: 'p-trace-batch', itemPlatform: 'x' },
        { embed: async () => {}, tag: async () => {} },
      );
      startCollectionProcessingJobs(
        { jobPlatform: 'p-trace-batch', itemPlatform: 'x' },
        { embed: async () => {}, tag: async () => {} },
      );
      await flush();

      expect(infoSpy.mock.calls.map((call) => call[1])).toEqual(
        expect.arrayContaining([
          'scheduler:batch-dispatch',
          'scheduler:batch-queued',
          'scheduler:batch-coalesced',
          'job:started',
        ]),
      );

      releaseFirst.resolve();
      await flush();
      await flush();

      expect(infoSpy.mock.calls.map((call) => call[1])).toContain('job:completed');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('drains the whole Embed and Tags backlogs at every sync end through the default deps', async () => {
    embedding.embedPlatformBacklog.mockClear();
    tagging.tagPlatformBacklog.mockClear();

    startCollectionProcessingJobs({ jobPlatform: 'p-default-backlog', itemPlatform: 'x' });
    await flush();

    expect(embedding.embedPlatformBacklog).toHaveBeenCalledTimes(1);
    expect(embedding.embedPlatformBacklog.mock.calls[0]?.[0]).toBe('x');
    expect(tagging.tagPlatformBacklog).toHaveBeenCalledTimes(1);
    expect(tagging.tagPlatformBacklog.mock.calls[0]?.[0]).toBe('x');
    expect(getJob('p-default-backlog', 'embed')?.phase).toBe('completed');
    expect(getJob('p-default-backlog', 'tag')?.phase).toBe('completed');
  });

  it('coalesces a third colliding tag backlog into the pending drain', async () => {
    const releaseFirst = deferred();
    const tagRuns: string[] = [];
    const depsFor = (label: string, hold?: Promise<void>) => ({
      embed: async () => {},
      tag: async () => {
        tagRuns.push(label);
        if (hold) await hold;
      },
    });

    startCollectionProcessingJobs(
      { jobPlatform: 'p-tag-coalesce', itemPlatform: 'x' },
      depsFor('a', releaseFirst.promise),
    );
    startCollectionProcessingJobs({ jobPlatform: 'p-tag-coalesce', itemPlatform: 'x' }, depsFor('b'));
    startCollectionProcessingJobs({ jobPlatform: 'p-tag-coalesce', itemPlatform: 'x' }, depsFor('c'));
    await flush();
    expect(tagRuns).toEqual(['a']);

    releaseFirst.resolve();
    await flush();
    await flush();
    // Same as embed: the pending whole-backlog drain covers the third
    // dispatch's items by definition. Exactly two runs, no loss.
    expect(tagRuns).toEqual(['a', 'b']);
    expect(getJob('p-tag-coalesce', 'tag')?.phase).toBe('completed');
  });

  it('parks a streaming tag drain behind the sync-end Tags backlog on the same lane', async () => {
    const releaseBacklog = deferred();
    const tagged: string[] = [];

    // Per-item platforms still get the sync-end backlog drain.
    startCollectionProcessingJobs(
      { jobPlatform: 'p-tag-backlog-stream', itemPlatform: 'bookmarks' },
      { embed: async () => {}, tag: () => releaseBacklog.promise },
    );
    await flush();

    const ticket = enqueueCollectionProcessingItem(
      { jobPlatform: 'p-tag-backlog-stream', itemPlatform: 'bookmarks', itemId: 'a' },
      {
        embed: async () => 'embedded' as const,
        tag: async (_platform, itemId) => {
          tagged.push(itemId);
          return 'tagged' as const;
        },
      },
    );
    await flush();
    expect(tagged).toEqual([]);

    releaseBacklog.resolve();
    await expect(ticket.tag).resolves.toBe('tagged');
    expect(tagged).toEqual(['a']);
  });

  it('coalesces a third colliding embed backlog into the pending drain', async () => {
    const releaseFirst = deferred();
    const embedRuns: string[] = [];
    const depsFor = (label: string, hold?: Promise<void>) => ({
      embed: async () => {
        embedRuns.push(label);
        if (hold) await hold;
      },
      tag: async () => {},
    });

    startCollectionProcessingJobs(
      { jobPlatform: 'p-embed-coalesce', itemPlatform: 'x' },
      depsFor('a', releaseFirst.promise),
    );
    startCollectionProcessingJobs({ jobPlatform: 'p-embed-coalesce', itemPlatform: 'x' }, depsFor('b'));
    startCollectionProcessingJobs({ jobPlatform: 'p-embed-coalesce', itemPlatform: 'x' }, depsFor('c'));
    await flush();
    expect(embedRuns).toEqual(['a']);

    releaseFirst.resolve();
    await flush();
    await flush();
    // The third dispatch merged into the pending run — its whole-backlog drain
    // covers the third batch's items by definition. Exactly two runs, no loss.
    expect(embedRuns).toEqual(['a', 'b']);
    expect(getJob('p-embed-coalesce', 'embed')?.phase).toBe('completed');
  });

  it('parks a streaming drain behind an active batch run on the same lane', async () => {
    const releaseBatch = deferred();
    const embedded: string[] = [];

    startCollectionProcessingJobs(
      { jobPlatform: 'p-batch-stream', itemPlatform: 'x' },
      { embed: () => releaseBatch.promise, tag: async () => {} },
    );
    await flush();

    const ticket = enqueueCollectionProcessingItem(
      { jobPlatform: 'p-batch-stream', itemPlatform: 'x', itemId: 'a' },
      {
        embed: async (_platform, itemId) => {
          embedded.push(itemId);
          return 'embedded' as const;
        },
        tag: async () => 'tagged' as const,
      },
    );
    await flush();
    // The drain is queued behind the batch run, never interleaved with it.
    expect(embedded).toEqual([]);

    releaseBatch.resolve();
    await Promise.all([ticket.embed, ticket.tag]);
    expect(embedded).toEqual(['a']);
    await flush();
    expect(getJob('p-batch-stream', 'embed')?.phase).toBe('completed');
  });

  it('traces Embed job progress and failure from the owning scheduler', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      startCollectionProcessingJobs(
        { jobPlatform: 'p-trace-failure', itemPlatform: 'x' },
        {
          embed: async (_platform, onProgress) => {
            onProgress({ done: 1, total: 2 });
            throw new Error('provider stopped');
          },
          tag: async () => {},
        },
      );
      await flush();

      expect(infoSpy.mock.calls.map((call) => call[1])).toContain('job:progress');
      expect(infoSpy.mock.calls.find((call) => call[1] === 'job:progress')?.[2]).toEqual(
        expect.objectContaining({
          jobPlatform: 'p-trace-failure',
          done: 1,
          total: 2,
        }),
      );
      expect(errorSpy.mock.calls.map((call) => call[1])).toContain('job:failed');
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

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

  it('keeps draining when resume arrives before the in-flight item reaches its checkpoint', async () => {
    const releaseFirstEmbed = deferred();
    const embedded: string[] = [];
    const deps = {
      embed: async (_platform: string, itemId: string) => {
        embedded.push(itemId);
        if (itemId === 'a') await releaseFirstEmbed.promise;
        return 'embedded' as const;
      },
      tag: async () => 'tagged' as const,
    };

    enqueueCollectionProcessingItem(
      { jobPlatform: 'p-resume-during-item', itemPlatform: 'x', itemId: 'a' },
      deps,
    );
    enqueueCollectionProcessingItem(
      { jobPlatform: 'p-resume-during-item', itemPlatform: 'x', itemId: 'b' },
      deps,
    );
    await vi.waitFor(() => expect(embedded).toEqual(['a']));

    pauseJob('p-resume-during-item', 'embed');
    expect(getJob('p-resume-during-item', 'embed')?.phase).toBe('pausing');
    resumeJob('p-resume-during-item', 'embed');
    releaseFirstEmbed.resolve();

    await vi.waitFor(() => expect(embedded).toEqual(['a', 'b']));
    expect(getJob('p-resume-during-item', 'embed')?.phase).toBe('completed');
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
      { jobPlatform: 'p-processing', itemPlatform: 'x' },
      {
        embed: async () => {},
        tag: async (_platform, _onProgress, control) => {
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

    startCollectionProcessingJobs({ jobPlatform: 'p-batches', itemPlatform: 'x' }, firstDeps);
    startCollectionProcessingJobs({ jobPlatform: 'p-batches', itemPlatform: 'x' }, secondDeps);
    await flush();

    expect(calls).toEqual(['embed:a', 'tag:a']);

    releaseFirst.resolve();
    await flush();
    await flush();

    // Per-lane FIFO is the contract; embed and tag are independent lanes, so
    // their cross-lane interleaving is unspecified.
    expect(calls.filter((c) => c.startsWith('embed:'))).toEqual(['embed:a', 'embed:b']);
    expect(calls.filter((c) => c.startsWith('tag:'))).toEqual(['tag:a', 'tag:b']);
  });

  it('holds a gated batch born-paused and resumes it without losing the batch', async () => {
    setJobGate((platform) => platform === 'p-gated-batch');
    try {
      const calls: string[] = [];
      const deps = {
        embed: async (
          _platform: string,
          _onProgress: (p: { done: number; total: number }) => void,
          control: { checkpoint: () => Promise<void> },
        ) => {
          await control.checkpoint();
          calls.push('embed');
        },
        tag: async (
          _platform: string,
          _onProgress: (p: { done: number; total: number }) => void,
          control: { checkpoint: () => Promise<void> },
        ) => {
          await control.checkpoint();
          calls.push('tag');
        },
      };

      startCollectionProcessingJobs({ jobPlatform: 'p-gated-batch', itemPlatform: 'x' }, deps);
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

      expect(calls.sort()).toEqual(['embed', 'tag']);
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
