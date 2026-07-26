// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('renders one accessible toggle in place across running, pausing, and paused states', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    act(() => {
      root.render(
        <PipelineProgressStrip
          segments={[
            {
              id: 'running',
              label: 'Fetch',
              done: 4,
              total: null,
              state: 'running',
              control: { kind: 'pause', label: 'Pause Fetch', disabled: false, onClick: pause },
            },
            {
              id: 'pausing',
              label: 'Embed',
              done: 2,
              total: 8,
              state: 'pausing',
              control: { kind: 'pausing', label: 'Pausing Embed', disabled: true },
            },
            {
              id: 'paused',
              label: 'Tags',
              done: 3,
              total: 8,
              state: 'paused',
              control: { kind: 'resume', label: 'Resume Tags', disabled: false, onClick: resume },
            },
          ]}
        />,
      );
    });

    const buttons = container.querySelectorAll('[data-pipeline-control]');
    expect(buttons).toHaveLength(3);
    expect(
      container.querySelector('button[aria-label="Pausing Embed"]')?.hasAttribute('disabled'),
    ).toBe(true);

    act(() => {
      (container.querySelector('button[aria-label="Pause Fetch"]') as HTMLButtonElement).click();
      (container.querySelector('button[aria-label="Resume Tags"]') as HTMLButtonElement).click();
    });
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
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
