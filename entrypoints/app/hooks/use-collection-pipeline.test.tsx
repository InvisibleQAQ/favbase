// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessingCoverage } from '@/lib/collections';

import type { BackgroundJob } from './background-jobs-store';
import type { UseCollectionPipelineResult } from './use-collection-pipeline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  useProcessingCoverage: vi.fn(),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => `L:${key}` }),
}));

vi.mock('./use-processing-coverage', () => ({
  useProcessingCoverage: mocks.useProcessingCoverage,
}));

import { collectionCoverageRefreshKey, useCollectionPipeline } from './use-collection-pipeline';

const coverage: ProcessingCoverage = {
  acquisition: { done: 12, total: null },
  content: { done: 8, total: 12 },
  embedding: { done: 5, total: 8 },
  tagging: { done: 3, total: 8 },
};

function job(generation: number, running = false): BackgroundJob {
  return {
    platform: 'p',
    kind: 'embed',
    phase: running ? 'running' : 'completed',
    running,
    progress: running ? { done: 1, total: 4 } : null,
    lastProgress: null,
    error: null,
    generation,
  };
}

describe('collectionCoverageRefreshKey', () => {
  it('derives the key from the sync flag and the embed/tag generations', () => {
    expect(collectionCoverageRefreshKey(true, job(2), job(5))).toBe('true:2:5');
    expect(collectionCoverageRefreshKey(false, null, null)).toBe('false:0:0');
  });

  it('appends platform-specific signals only when provided', () => {
    expect(collectionCoverageRefreshKey(false, null, null, 'x:1')).toBe('false:0:0:x:1');
    expect(collectionCoverageRefreshKey(false, null, null, false)).toBe('false:0:0:false');
    // bilibili's fallback page passes a bare generation number; 0 is a real signal, not "absent".
    expect(collectionCoverageRefreshKey(false, null, null, 0)).toBe('false:0:0:0');
    expect(collectionCoverageRefreshKey(false, null, null, null)).toBe('false:0:0:null');
    expect(collectionCoverageRefreshKey(false, null, null, undefined)).toBe('false:0:0');
  });
});

describe('useCollectionPipeline', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: UseCollectionPipelineResult | null;

  function Probe(props: Parameters<typeof useCollectionPipeline>[0]) {
    latest = useCollectionPipeline(props);
    return null;
  }

  beforeEach(() => {
    latest = null;
    mocks.useProcessingCoverage.mockReset();
    mocks.useProcessingCoverage.mockReturnValue({
      coverage,
      status: 'ready',
      loading: false,
      error: null,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('owns the coverage refresh key, translated labels and the standard stage order', () => {
    act(() =>
      root.render(
        <Probe
          platform="github"
          syncing={true}
          fetch={{ running: true, phase: 'running', progress: { done: 4, total: null } }}
          content={{ id: 'readme', label: 'README', runtime: null }}
          embedJob={job(2, true)}
          tagJob={job(7)}
          extraRefreshKey="extra"
        />,
      ),
    );

    expect(mocks.useProcessingCoverage).toHaveBeenCalledWith('github', 'true:2:7:extra');
    expect(latest?.coverage).toBe(coverage);
    expect(latest?.coverageStatus).toBe('ready');
    expect(latest?.segments).toEqual([
      { id: 'fetch', label: 'L:pipeline.fetch', done: 4, total: null, state: 'running' },
      { id: 'readme', label: 'README', done: 8, total: 12, state: 'idle' },
      { id: 'embedding', label: 'L:pipeline.embedding', done: 1, total: 4, state: 'running' },
      { id: 'tagging', label: 'L:pipeline.tagging', done: 3, total: 8, state: 'completed' },
    ]);
  });

  it('omits the content stage and keeps a settled Fetch at 100% when no content stage exists', () => {
    act(() =>
      root.render(
        <Probe
          platform="x"
          syncing={false}
          fetch={{ running: false, phase: 'completed', lastProgress: { done: 9, total: null } }}
          embedJob={null}
          tagJob={null}
        />,
      ),
    );

    expect(mocks.useProcessingCoverage).toHaveBeenCalledWith('x', 'false:0:0');
    expect(latest?.segments.map((segment) => segment.id)).toEqual(['fetch', 'embedding', 'tagging']);
    expect(latest?.segments[0]).toEqual({
      id: 'fetch',
      label: 'L:pipeline.fetch',
      done: 9,
      total: null,
      percent: 100,
      state: 'completed',
    });
  });
});
