// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingStats } from '@/lib/embedding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getEmbeddingStats: vi.fn(),
  listeners: new Map<string, () => void>(),
}));

vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(async () => ({ kind: 'db' })) }));

vi.mock('@/lib/embedding', () => ({
  getEmbeddingStats: mocks.getEmbeddingStats,
}));

vi.mock('@/lib/events', () => ({
  onDomainEvent: vi.fn((type: string, listener: () => void) => {
    mocks.listeners.set(type, listener);
    return () => mocks.listeners.delete(type);
  }),
}));

import { useEmbeddingStats } from './use-embedding-stats';

function Probe() {
  const { stats } = useEmbeddingStats();
  return <output>{stats ? `${stats.embeddedChunks}/${stats.totalChunks}` : 'loading'}</output>;
}

describe('useEmbeddingStats', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getEmbeddingStats.mockReset();
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

  it('refreshes durable stats when content or embeddings change and coalesces bursts', async () => {
    const initial: EmbeddingStats = { embeddedChunks: 3, totalChunks: 3 };
    const updated: EmbeddingStats = { embeddedChunks: 6, totalChunks: 12 };
    mocks.getEmbeddingStats.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);
    expect(container.textContent).toBe('3/3');

    await act(async () => mocks.listeners.get('item-content-updated')?.());
    await act(async () => mocks.listeners.get('item-embedded')?.());
    expect(mocks.getEmbeddingStats).toHaveBeenCalledTimes(1);

    await act(async () => vi.runAllTimersAsync());
    expect(mocks.getEmbeddingStats).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('6/12');
    expect([...mocks.listeners.keys()].sort()).toEqual([
      'item-content-updated',
      'item-embedded',
    ]);
  });
});
