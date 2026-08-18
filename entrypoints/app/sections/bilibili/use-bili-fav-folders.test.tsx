// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder } from '@/lib/bilibili/types';

const serviceMocks = vi.hoisted(() => ({
  fetchAndSyncFolders: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  runBiliStreamingSync: vi.fn(),
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  ...serviceMocks,
  BiliAuthError: class BiliAuthError extends Error {},
}));

vi.mock('./auto-transcribe-runtime', () => runtimeMocks);

// The shared Sync Adapter pulls it in; the real module loads the
// embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: vi.fn(),
}));

import { useBiliFavFolders } from './use-bili-fav-folders';

function makeFolder(id: number, title: string): BiliFavFolder {
  return {
    id,
    fid: id,
    mid: 1,
    title,
    media_count: 20,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
  };
}

const FOLDERS: BiliFavFolder[] = [makeFolder(10, 'Default folder')];

describe('useBiliFavFolders sync boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useBiliFavFolders> | null;
  let routeFolderId: number | undefined;

  function Probe() {
    current = useBiliFavFolders(routeFolderId);
    return null;
  }

  beforeEach(() => {
    serviceMocks.fetchAndSyncFolders.mockReset().mockResolvedValue(FOLDERS);
    runtimeMocks.runBiliStreamingSync.mockReset().mockResolvedValue({
      fetchedCount: 20,
      syncedCount: 20,
    });
    routeFolderId = undefined;
    current = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('loads folder metadata on mount without starting full video pagination', async () => {
    await act(async () => {
      root.render(<Probe />);
    });

    expect(serviceMocks.fetchAndSyncFolders).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.runBiliStreamingSync).not.toHaveBeenCalled();
    expect(current?.folders).toEqual(FOLDERS);
  });

  it('does not scan or continue historical pending items on mount', async () => {
    await act(async () => {
      root.render(<Probe />);
    });

    expect(runtimeMocks.runBiliStreamingSync).not.toHaveBeenCalled();
  });

  it('does not auto-continue on mount when not logged in', async () => {
    const { BiliAuthError } = await import('@/lib/bilibili/bili-sync-service');
    serviceMocks.fetchAndSyncFolders.mockRejectedValue(new BiliAuthError('not logged in'));

    await act(async () => {
      root.render(<Probe />);
    });

    expect(runtimeMocks.runBiliStreamingSync).not.toHaveBeenCalled();
    expect(current?.loginState).toBe('not_logged_in');
  });

  it('runs Fetch and streaming transcription through one runtime', async () => {
    serviceMocks.fetchAndSyncFolders.mockResolvedValue([
      makeFolder(10, 'Default folder'),
      makeFolder(20, 'Second folder'),
    ]);

    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await current?.sync();
    });

    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledOnce();
    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledWith(
      [makeFolder(10, 'Default folder'), makeFolder(20, 'Second folder')],
      expect.any(Function),
      expect.objectContaining({ checkpoint: expect.any(Function) }),
    );
  });

  it('puts the route-selected folder first in the transcription order', async () => {
    routeFolderId = 20;
    serviceMocks.fetchAndSyncFolders.mockResolvedValue([
      makeFolder(10, 'Default folder'),
      makeFolder(20, 'Second folder'),
    ]);

    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await current?.sync();
    });

    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledWith(
      [makeFolder(20, 'Second folder'), makeFolder(10, 'Default folder')],
      expect.any(Function),
      expect.objectContaining({ checkpoint: expect.any(Function) }),
    );
  });

  it('starts full video pagination only from the explicit sync action', async () => {
    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await current?.sync();
    });

    expect(serviceMocks.fetchAndSyncFolders).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledOnce();
    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledWith(
      FOLDERS,
      expect.any(Function),
      expect.objectContaining({ checkpoint: expect.any(Function) }),
    );
  });

  it('rejoins an in-flight full sync after remount without starting another worker', async () => {
    let finishSync!: () => void;
    runtimeMocks.runBiliStreamingSync.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
    );

    await act(async () => {
      root.render(<Probe />);
    });
    act(() => {
      void current?.sync();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledOnce();

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });

    expect(current?.syncing).toBe(true);
    act(() => {
      void current?.sync();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(runtimeMocks.runBiliStreamingSync).toHaveBeenCalledOnce();

    await act(async () => {
      finishSync();
      await Promise.resolve();
    });
  });
});
