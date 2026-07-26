import { describe, expect, it } from 'vitest';

import {
  backgroundJobRuntime,
  buildPipelineSegment,
  buildPipelineSegments,
  readJobProgress,
} from './pipeline-segments';
import { getJob, startJob } from './background-jobs-store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('pipeline segment adapters', () => {
  it('maps one background job to a display-only runtime snapshot', async () => {
    const finish = deferred();
    startJob('p-runtime-adapter', 'sync', async (setProgress) => {
      setProgress({ done: 2, total: null });
      await finish.promise;
    });

    const runtime = backgroundJobRuntime(getJob('p-runtime-adapter', 'sync'));

    // Display-only: no pause/resume actions here — the per-platform library
    // gate owns run control, backed by pauseJob/resumeJob in the store.
    expect(runtime).toEqual({
      phase: 'running',
      running: true,
      progress: { done: 2, total: null },
      lastProgress: null,
      error: null,
    });
    expect(backgroundJobRuntime(null)).toBeNull();

    finish.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('reflects an active pausing phase on a control-free segment', () => {
    const idle = { done: 8, total: 10 };

    expect(
      buildPipelineSegments({
        coverage: {
          acquisition: idle,
          content: idle,
          embedding: idle,
          tagging: idle,
        },
        coverageStatus: 'ready',
        stages: [
          {
            id: 'embedding',
            label: 'Embed',
            coverage: 'embedding',
            runtime: {
              phase: 'pausing',
              running: true,
              progress: { done: 3, total: 10 },
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'embedding',
        label: 'Embed',
        done: 3,
        total: 10,
        state: 'pausing',
      },
    ]);
  });

  it('retains a completed Fetch run while terminal processing stages use DB coverage', () => {
    const coverage = {
      acquisition: { done: 40, total: null },
      content: { done: 20, total: 40 },
      embedding: { done: 18, total: 20 },
      tagging: { done: 16, total: 20 },
    };

    expect(
      buildPipelineSegments({
        coverage,
        coverageStatus: 'ready',
        stages: [
          {
            id: 'sync',
            label: 'Fetch',
            coverage: 'acquisition',
            completedProgress: 'last-run',
            runtime: {
              phase: 'completed',
              running: false,
              lastProgress: { done: 12, total: null },
            },
          },
          {
            id: 'embedding',
            label: 'Embed',
            coverage: 'embedding',
            runtime: {
              phase: 'completed',
              running: false,
              lastProgress: { done: 4, total: 4 },
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'sync',
        label: 'Fetch',
        done: 12,
        total: null,
        percent: 100,
        state: 'completed',
      },
      {
        id: 'embedding',
        label: 'Embed',
        done: 18,
        total: 20,
        state: 'completed',
      },
    ]);
  });

  it('uses live progress while running and returns to DB coverage while idle', () => {
    const idle = { done: 8, total: 10 };

    expect(
      buildPipelineSegment({
        id: 'content',
        label: 'Content',
        idle,
        running: true,
        progress: { done: 3, total: 6 },
      }),
    ).toEqual({ id: 'content', label: 'Content', done: 3, total: 6, state: 'running' });
    expect(
      buildPipelineSegment({ id: 'content', label: 'Content', idle, running: false }),
    ).toEqual({ id: 'content', label: 'Content', done: 8, total: 10, state: 'idle' });
  });

  it('preserves an unknown live total and rejects malformed job payloads', () => {
    expect(
      buildPipelineSegment({
        id: 'acquire',
        label: 'Acquire',
        idle: { done: 12, total: null },
        running: true,
        progress: { done: 4, total: null },
      }),
    ).toMatchObject({ done: 4, total: null, state: 'running' });
    expect(readJobProgress({ done: 2, total: 5 })).toEqual({ done: 2, total: 5 });
    expect(readJobProgress({ done: '2', total: 5 })).toBeNull();
    expect(readJobProgress(null)).toBeNull();
  });

  it('maps coverage availability and keeps Embedding and Tagging runtimes independent', () => {
    const coverage = {
      acquisition: { done: 12, total: null },
      content: { done: 8, total: 12 },
      embedding: { done: 5, total: 8 },
      tagging: { done: 3, total: 8 },
    };

    expect(
      buildPipelineSegments({
        coverage,
        coverageStatus: 'loading',
        stages: [
          { id: 'embedding', label: 'Embed', coverage: 'embedding' },
          { id: 'tagging', label: 'Tags', coverage: 'tagging' },
        ],
      }),
    ).toEqual([
      { id: 'embedding', label: 'Embed', done: null, total: null, state: 'loading' },
      { id: 'tagging', label: 'Tags', done: null, total: null, state: 'loading' },
    ]);

    expect(
      buildPipelineSegments({
        coverage,
        coverageStatus: 'error',
        stages: [{ id: 'embedding', label: 'Embed', coverage: 'embedding' }],
      }),
    ).toEqual([
      { id: 'embedding', label: 'Embed', done: null, total: null, state: 'failed' },
    ]);

    expect(
      buildPipelineSegments({
        coverage,
        coverageStatus: 'ready',
        stages: [
          {
            id: 'embedding',
            label: 'Embed',
            coverage: 'embedding',
            runtime: { running: true, progress: { done: 2, total: 4 } },
          },
          { id: 'tagging', label: 'Tags', coverage: 'tagging' },
        ],
      }),
    ).toEqual([
      { id: 'embedding', label: 'Embed', done: 2, total: 4, state: 'running' },
      { id: 'tagging', label: 'Tags', done: 3, total: 8, state: 'idle' },
    ]);
  });
});
