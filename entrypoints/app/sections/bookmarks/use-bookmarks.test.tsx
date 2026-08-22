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

const extractionMocks = vi.hoisted(() => ({
  startBookmarkExtraction: vi.fn(),
}));

const processingMocks = vi.hoisted(() => ({
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/database', () => ({
  initDbProxy: vi.fn(async () => ({})),
}));

vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => serviceMocks);

vi.mock('./use-bookmark-extraction', () => extractionMocks);

// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => processingMocks);

import { useBookmarks, type UseBookmarksReturn } from './use-bookmarks';

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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
    extractionMocks.startBookmarkExtraction.mockReset();
    processingMocks.startCollectionProcessingJobs.mockReset();
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

  it('chains content extraction after the metadata sync succeeds', async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    expect(extractionMocks.startBookmarkExtraction).not.toHaveBeenCalled();

    finishSync();
    await act(async () => {});

    expect(extractionMocks.startBookmarkExtraction).toHaveBeenCalledTimes(1);
  });

  it('dispatches the backlog embed lane (empty ids) after the metadata sync succeeds', async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    expect(processingMocks.startCollectionProcessingJobs).not.toHaveBeenCalled();

    finishSync();
    await act(async () => {});

    expect(processingMocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'bookmarks',
      itemPlatform: 'bookmarks',
      itemIds: [],
    });
  });

  it('maps the route folder to the query and returns to page 1 when the folder changes', async () => {
    let latest!: UseBookmarksReturn;
    function FolderProbe({ folderId }: { folderId: string | undefined }) {
      latest = useBookmarks(folderId);
      return null;
    }
    const pageQueries = () =>
      serviceMocks.getBookmarks.mock.calls
        .map(([query]) => query as { folderId?: string; page: number; pageSize: number })
        .filter((q) => q.pageSize !== 1);

    await act(async () => {
      root.render(<FolderProbe folderId="f1" />);
    });
    await flush();
    expect(pageQueries().at(-1)).toMatchObject({ folderId: 'f1', page: 1 });

    act(() => latest.goToPage(2));
    await flush();
    expect(pageQueries().at(-1)).toMatchObject({ folderId: 'f1', page: 2 });

    await act(async () => {
      root.render(<FolderProbe folderId="f2" />);
    });
    await flush();

    expect(latest.page).toBe(1);
    expect(pageQueries().at(-1)).toMatchObject({ folderId: 'f2', page: 1 });
    // The route is the only folder source of truth: no query with (new folder, old page).
    expect(pageQueries()).not.toContainEqual(expect.objectContaining({ folderId: 'f2', page: 2 }));

    await act(async () => {
      root.render(<FolderProbe folderId={undefined} />);
    });
    await flush();
    expect(pageQueries().at(-1)).toMatchObject({ folderId: undefined, page: 1 });
  });
});
