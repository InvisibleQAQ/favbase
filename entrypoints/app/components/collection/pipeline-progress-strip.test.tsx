// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PipelineProgressStrip } from './pipeline-progress-strip';

describe('PipelineProgressStrip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps idle segments visible and renders known and unknown counters', () => {
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[
            { id: 'acquire', label: 'Acquire', done: 12, total: null, state: 'idle' },
            { id: 'embedding', label: 'Embedding', done: 7, total: 10, state: 'idle' },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain('Acquire12/--');
    expect(container.textContent).toContain('Embedding7/10 70%');
    expect(container.querySelectorAll('[data-pipeline-segment]')).toHaveLength(2);
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Acquire"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelector('[aria-label="Embedding"]')?.getAttribute('aria-valuenow')).toBe('70');
  });

  it('shows only truthful percentages for empty and completed unknown-total runs', () => {
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[
            { id: 'empty', label: 'Empty', done: 0, total: 0, state: 'idle' },
            {
              id: 'acquire',
              label: 'Fetch',
              done: 12,
              total: null,
              percent: 100,
              state: 'completed',
            },
          ]}
        />,
      );
    });

    expect(container.querySelector('[data-segment-id="empty"]')?.textContent).toBe('Empty0/0');
    expect(container.querySelector('[data-segment-id="acquire"]')?.textContent).toContain(
      'Fetch12/-- 100%',
    );
  });

  it('uses indeterminate motion only for a running segment with an unknown total', () => {
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[
            { id: 'acquire', label: 'Acquire', done: 4, total: null, state: 'running' },
            { id: 'tagging', label: 'Tagging', done: 2, total: 8, state: 'running' },
          ]}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Acquire"]')?.getAttribute('aria-valuenow')).toBeNull();
    expect(container.querySelector('[aria-label="Tagging"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(
      container.querySelector('[data-segment-id="acquire"]')?.getAttribute('data-segment-state'),
    ).toBe('running');
  });

  it('renders no per-segment controls — pause/resume lives in the library gate', () => {
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[
            { id: 'running', label: 'Fetch', done: 4, total: null, state: 'running' },
            { id: 'pausing', label: 'Embed', done: 2, total: 8, state: 'pausing' },
            { id: 'paused', label: 'Tags', done: 3, total: 8, state: 'paused' },
          ]}
        />,
      );
    });

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(
      container.querySelector('[data-segment-id="pausing"]')?.getAttribute('data-segment-state'),
    ).toBe('pausing');
  });

  it('keeps unavailable coverage explicit while loading', () => {
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[{ id: 'tagging', label: 'Tagging', done: null, total: null, state: 'loading' }]}
        />,
      );
    });

    expect(container.textContent).toContain('Tagging--/--');
    expect(container.querySelector('[aria-label="Tagging"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(container.querySelector('[data-segment-state="loading"]')).not.toBeNull();
  });
});
