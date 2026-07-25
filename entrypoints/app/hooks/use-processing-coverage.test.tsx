// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessingCoverage } from '@/lib/collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getProcessingCoverage: vi.fn(),
  listeners: new Map<string, (payload: { platform: string }) => void>(),
}));

vi.mock('@/lib/collections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/collections')>()),
  getProcessingCoverage: mocks.getProcessingCoverage,
}));

vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(async () => ({ kind: 'db' })) }));

vi.mock('@/lib/events', () => ({
  onDomainEvent: vi.fn((type: string, listener: (payload: { platform: string }) => void) => {
    mocks.listeners.set(type, listener);
    return () => mocks.listeners.delete(type);
  }),
}));

import { useProcessingCoverage } from './use-processing-coverage';

function snapshot(acquired: number): ProcessingCoverage {
  return {
    acquisition: { done: acquired, total: null },
    content: { done: acquired, total: acquired },
    embedding: { done: acquired, total: acquired },
    tagging: { done: acquired, total: acquired },
  };
}

function Probe() {
  const state = useProcessingCoverage('github');
  return <output data-acquired>{state.coverage?.acquisition.done ?? -1}</output>;
}

describe('useProcessingCoverage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getProcessingCoverage.mockReset();
    mocks.listeners.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('loads once and refreshes only for matching DB-backed domain events', async () => {
    mocks.getProcessingCoverage
      .mockResolvedValueOnce(snapshot(3))
      .mockResolvedValueOnce(snapshot(4));

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);
    expect(container.querySelector('[data-acquired]')?.textContent).toBe('3');
    expect(mocks.getProcessingCoverage).toHaveBeenCalledTimes(1);

    await act(async () => mocks.listeners.get('item-tagged')?.({ platform: 'youtube' }));
    expect(mocks.getProcessingCoverage).toHaveBeenCalledTimes(1);

    await act(async () => mocks.listeners.get('item-embedded')?.({ platform: 'github' }));
    await act(async () => vi.runAllTimersAsync());
    expect(container.querySelector('[data-acquired]')?.textContent).toBe('4');
    expect(mocks.getProcessingCoverage).toHaveBeenCalledTimes(2);
    expect([...mocks.listeners.keys()].sort()).toEqual([
      'item-content-updated',
      'item-embedded',
      'item-tagged',
    ]);
  });

  it('coalesces matching event bursts into one coverage query', async () => {
    mocks.getProcessingCoverage
      .mockResolvedValueOnce(snapshot(3))
      .mockResolvedValueOnce(snapshot(4));

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);

    await act(async () => mocks.listeners.get('item-content-updated')?.({ platform: 'github' }));
    await act(async () => mocks.listeners.get('item-embedded')?.({ platform: 'github' }));
    expect(mocks.getProcessingCoverage).toHaveBeenCalledTimes(1);

    await act(async () => vi.runAllTimersAsync());
    expect(mocks.getProcessingCoverage).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-acquired]')?.textContent).toBe('4');
  });
});
