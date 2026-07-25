import { describe, expect, it } from 'vitest';

import {
  buildPipelineSegment,
  buildPipelineSegments,
  readJobProgress,
} from './pipeline-segments';

describe('pipeline segment adapters', () => {
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
