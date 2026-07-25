// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CollectionAnalyticsSnapshot } from '@/lib/collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getCollectionAnalytics: vi.fn(),
  eventListener: null as null | (() => void),
}));

vi.mock('@/lib/collections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/collections')>()),
  getCollectionAnalytics: mocks.getCollectionAnalytics,
}));

vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(async () => undefined) }));

vi.mock('@/lib/events', () => ({
  onDomainEvent: vi.fn((_type: string, listener: () => void) => {
    mocks.eventListener = listener;
    return () => {
      mocks.eventListener = null;
    };
  }),
}));

import {
  selectInitialAnalyticsPlatform,
  useCollectionAnalytics,
} from './use-collection-analytics';

function snapshot(counts: Partial<Record<string, number>>): CollectionAnalyticsSnapshot {
  const platforms = ['bilibili', 'github', 'bookmarks', 'x', 'zhihu', 'youtube'] as const;
  const totalItems = platforms.reduce((sum, platform) => sum + (counts[platform] ?? 0), 0);
  return {
    totalItems,
    usedTags: 0,
    taggedItems: 0,
    topTags: [],
    platforms: platforms.map((platform) => ({
      platform,
      itemCount: counts[platform] ?? 0,
      share: totalItems === 0 ? 0 : (counts[platform] ?? 0) / totalItems,
      dimensions: [],
    })),
  };
}

function Probe() {
  const analytics = useCollectionAnalytics();
  return (
    <div>
      <output data-selected>{analytics.selectedPlatform}</output>
      <button type="button" onClick={() => analytics.selectPlatform('x')}>
        select-x
      </button>
    </div>
  );
}

describe('useCollectionAnalytics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.getCollectionAnalytics.mockReset();
    mocks.eventListener = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('breaks largest-platform ties in registry order', () => {
    expect(selectInitialAnalyticsPlatform(snapshot({ github: 4, bookmarks: 4 }))).toBe('github');
  });

  it('selects the largest platform once and preserves manual selection across refresh', async () => {
    mocks.getCollectionAnalytics
      .mockResolvedValueOnce(snapshot({ github: 4, youtube: 2 }))
      .mockResolvedValueOnce(snapshot({ youtube: 9, github: 1 }));

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);
    expect(container.querySelector('[data-selected]')?.textContent).toBe('github');

    act(() => container.querySelector('button')?.click());
    expect(container.querySelector('[data-selected]')?.textContent).toBe('x');

    await act(async () => mocks.eventListener?.());
    await act(async () => undefined);
    expect(container.querySelector('[data-selected]')?.textContent).toBe('x');
  });

  it('waits for the first non-empty snapshot before initializing the largest platform', async () => {
    mocks.getCollectionAnalytics
      .mockResolvedValueOnce(snapshot({}))
      .mockResolvedValueOnce(snapshot({ github: 4, youtube: 2 }));

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);
    expect(container.querySelector('[data-selected]')?.textContent).toBe('bilibili');

    await act(async () => mocks.eventListener?.());
    await act(async () => undefined);
    expect(container.querySelector('[data-selected]')?.textContent).toBe('github');
  });

  it('keeps a manual empty-state selection when later data arrives', async () => {
    mocks.getCollectionAnalytics
      .mockResolvedValueOnce(snapshot({}))
      .mockResolvedValueOnce(snapshot({ github: 4, youtube: 2 }));

    await act(async () => root.render(<Probe />));
    await act(async () => undefined);
    act(() => container.querySelector('button')?.click());

    await act(async () => mocks.eventListener?.());
    await act(async () => undefined);
    expect(container.querySelector('[data-selected]')?.textContent).toBe('x');
  });
});
