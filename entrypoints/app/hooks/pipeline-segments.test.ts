import { describe, expect, it } from 'vitest';

import {
  backgroundJobRuntime,
  buildPipelineSegment,
  buildPipelineSegments,
  collectionPipelineStages,
  deriveTaggingBudgetHold,
  fetchedCountProgress,
  readJobProgress,
  transcriptionStage,
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

describe('collectionPipelineStages', () => {
  const labels = { fetch: 'Fetch', embedding: 'Embed', tagging: 'Tags' };
  const fetch = { running: true, progress: { done: 3, total: null } };

  it('declares Fetch -> Embedding -> Tagging with last-run retention only on Fetch', () => {
    expect(collectionPipelineStages({ labels, fetch, embedJob: null, tagJob: null })).toEqual([
      {
        id: 'fetch',
        label: 'Fetch',
        coverage: 'acquisition',
        completedProgress: 'last-run',
        runtime: fetch,
      },
      { id: 'embedding', label: 'Embed', coverage: 'embedding', runtime: null },
      { id: 'tagging', label: 'Tags', coverage: 'tagging', runtime: null },
    ]);
  });

  it('slots the platform content stage between Fetch and Embedding', () => {
    const content = { id: 'extraction', label: 'Extract', runtime: { running: false } };
    const stages = collectionPipelineStages({ labels, fetch, content, embedJob: null, tagJob: null });

    expect(stages.map((stage) => stage.id)).toEqual(['fetch', 'extraction', 'embedding', 'tagging']);
    expect(stages[1]).toEqual({
      id: 'extraction',
      label: 'Extract',
      coverage: 'content',
      runtime: content.runtime,
    });
  });

  it('maps embed/tag jobs through the default runtime adapter', () => {
    const embedJob = {
      platform: 'p',
      kind: 'embed' as const,
      phase: 'running' as const,
      running: true,
      progress: { done: 2, total: 5 },
      lastProgress: null,
      error: null,
      generation: 1,
    };

    expect(
      collectionPipelineStages({ labels, fetch, embedJob, tagJob: null })[1]?.runtime,
    ).toEqual({
      phase: 'running',
      running: true,
      progress: { done: 2, total: 5 },
      lastProgress: null,
      error: null,
    });
  });

  it('adapts a running fetchedCount into an open-ended acquisition count', () => {
    expect(fetchedCountProgress({ fetchedCount: 25 })).toEqual({ done: 25, total: null });
    expect(fetchedCountProgress(null)).toBeNull();
  });

  it("declares the shared transcription content stage over the platform's transcribe job", () => {
    const transcribeJob = {
      platform: 'p',
      kind: 'transcribe' as const,
      phase: 'running' as const,
      running: true,
      progress: { done: 3, total: 9 },
      lastProgress: null,
      error: null,
      generation: 2,
    };

    expect(transcriptionStage('Transcribe', transcribeJob)).toEqual({
      id: 'transcription',
      label: 'Transcribe',
      runtime: {
        phase: 'running',
        running: true,
        progress: { done: 3, total: 9 },
        lastProgress: null,
        error: null,
      },
    });
    expect(transcriptionStage('Transcribe', null)).toEqual({
      id: 'transcription',
      label: 'Transcribe',
      runtime: null,
    });
  });
});

describe('Tagging Budget hold (docs/41 D8)', () => {
  const ready = {
    acquisition: { done: 12, total: null },
    content: { done: 8, total: 12 },
    embedding: { done: 8, total: 8 },
    tagging: { done: 3, total: 8 },
  };
  const tagSegment = (overrides: Partial<Parameters<typeof buildPipelineSegment>[0]> = {}) =>
    buildPipelineSegment({
      id: 'tagging',
      label: 'Tags',
      idle: { done: 3, total: 8 },
      running: false,
      deferredNote: 'Daily limit reached',
      ...overrides,
    });

  it('derives a hold only at the cap, with ready coverage and untagged items waiting', () => {
    expect(deriveTaggingBudgetHold(ready, 'ready', 1_200)).toEqual({ spent: 1_200, pending: 5 });
    expect(deriveTaggingBudgetHold(ready, 'ready', null)).toBeNull();
    expect(deriveTaggingBudgetHold(ready, 'loading', 1_200)).toBeNull();
    expect(deriveTaggingBudgetHold(ready, 'error', 1_200)).toBeNull();
    expect(
      deriveTaggingBudgetHold({ ...ready, tagging: { done: 8, total: 8 } }, 'ready', 1_200),
    ).toBeNull();
    expect(
      deriveTaggingBudgetHold({ ...ready, tagging: { done: 0, total: null } }, 'ready', 1_200),
    ).toBeNull();
  });

  it('shows a held Tags segment as deferred over an idle or completed run, with DB coverage and the note', () => {
    expect(tagSegment()).toEqual({
      id: 'tagging',
      label: 'Tags',
      done: 3,
      total: 8,
      state: 'deferred',
      note: 'Daily limit reached',
    });
    // A drain that stopped at the first deferred item settles as completed.
    expect(tagSegment({ phase: 'completed' })).toMatchObject({ state: 'deferred', done: 3, total: 8 });
  });

  it('never lets the hold hide live, paused, failed or unknown work', () => {
    expect(
      tagSegment({ running: true, phase: 'running', progress: { done: 1, total: 4 } }),
    ).toEqual({ id: 'tagging', label: 'Tags', done: 1, total: 4, state: 'running' });
    expect(tagSegment({ running: true, phase: 'pausing' }).state).toBe('pausing');
    expect(tagSegment({ running: true, phase: 'paused' }).state).toBe('paused');
    expect(tagSegment({ phase: 'failed' }).state).toBe('failed');
    expect(tagSegment({ error: true }).state).toBe('failed');
    expect(tagSegment({ coverageStatus: 'loading' })).toEqual({
      id: 'tagging',
      label: 'Tags',
      done: null,
      total: null,
      state: 'loading',
    });
    expect(tagSegment({ coverageStatus: 'error' }).state).toBe('failed');
  });

  it('carries the note only on a deferred segment', () => {
    expect(tagSegment({ running: true, phase: 'running' })).not.toHaveProperty('note');
    expect(tagSegment({ deferredNote: undefined })).toEqual({
      id: 'tagging',
      label: 'Tags',
      done: 3,
      total: 8,
      state: 'idle',
    });
  });

  it('passes the note to the Tagging stage only', () => {
    const labels = { fetch: 'Fetch', embedding: 'Embed', tagging: 'Tags' };
    const stages = collectionPipelineStages({
      labels,
      fetch: null,
      embedJob: null,
      tagJob: null,
      taggingDeferredNote: 'Daily limit reached',
    });
    expect(stages.map((stage) => stage.deferredNote)).toEqual([
      undefined,
      undefined,
      'Daily limit reached',
    ]);
    expect(
      collectionPipelineStages({ labels, fetch: null, embedJob: null, tagJob: null, taggingDeferredNote: null })[2],
    ).not.toHaveProperty('deferredNote');

    const segments = buildPipelineSegments({ coverage: ready, coverageStatus: 'ready', stages });
    expect(segments.map((segment) => segment.state)).toEqual(['idle', 'idle', 'deferred']);
    expect(segments.filter((segment) => 'note' in segment).map((segment) => segment.id)).toEqual([
      'tagging',
    ]);
  });
});
