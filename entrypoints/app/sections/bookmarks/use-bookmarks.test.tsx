// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const serviceMocks = vi.hoisted(() => ({
  syncBookmarks: vi.fn(),
  getBookmarks: vi.fn(),
  getFolders: vi.fn(),
  getLastSyncedAt: vi.fn(),
}));

vi.mock('@/lib/database', () => ({
  initDbProxy: vi.fn(async () => ({})),
}));

vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => serviceMocks);

import { useBookmarks } from './use-bookmarks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useBookmarks sync ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let finishSync: () => void;

  function Probe() {
    useBookmarks(undefined);
    return null;
  }

  beforeEach(() => {
    const gate = deferred<{
      totalBookmarks: number;
      syncedItems: number;
      folders: number;
    }>();
    finishSync = () => gate.resolve({ totalBookmarks: 0, syncedItems: 0, folders: 0 });
    serviceMocks.syncBookmarks.mockReset().mockReturnValue(gate.promise);
    serviceMocks.getBookmarks.mockReset().mockResolvedValue({ rows: [], total: 0 });
    serviceMocks.getFolders.mockReset().mockResolvedValue([]);
    serviceMocks.getLastSyncedAt.mockReset().mockResolvedValue(null);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    finishSync();
    await act(async () => {});
    act(() => root.unmount());
    container.remove();
  });

  it('rejoins the same metadata sync after a route remount', async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    act(() => root.unmount());
    root = createRoot(container);

    await act(async () => {
      root.render(<Probe />);
    });

    expect(serviceMocks.syncBookmarks).toHaveBeenCalledTimes(1);
  });
});
