// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder } from '@/lib/bilibili/types';

const serviceMocks = vi.hoisted(() => ({
  fetchAndSyncFolders: vi.fn(),
  syncAllFavoriteVideos: vi.fn(),
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  ...serviceMocks,
  BiliAuthError: class BiliAuthError extends Error {},
}));

import { useBiliFavFolders } from './use-bili-fav-folders';

const FOLDERS: BiliFavFolder[] = [
  {
    id: 10,
    fid: 10,
    mid: 1,
    title: 'Default folder',
    media_count: 20,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
  },
];

describe('useBiliFavFolders sync boundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReturnType<typeof useBiliFavFolders> | null;

  function Probe() {
    current = useBiliFavFolders();
    return null;
  }

  beforeEach(() => {
    serviceMocks.fetchAndSyncFolders.mockReset().mockResolvedValue(FOLDERS);
    serviceMocks.syncAllFavoriteVideos.mockReset().mockResolvedValue({
      fetchedCount: 20,
      syncedCount: 20,
    });
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
    expect(serviceMocks.syncAllFavoriteVideos).not.toHaveBeenCalled();
    expect(current?.folders).toEqual(FOLDERS);
  });

  it('starts full video pagination only from the explicit sync action', async () => {
    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await current?.sync();
    });

    expect(serviceMocks.fetchAndSyncFolders).toHaveBeenCalledTimes(2);
    expect(serviceMocks.syncAllFavoriteVideos).toHaveBeenCalledOnce();
    expect(serviceMocks.syncAllFavoriteVideos).toHaveBeenCalledWith(
      FOLDERS,
      expect.any(Function),
    );
  });
});
