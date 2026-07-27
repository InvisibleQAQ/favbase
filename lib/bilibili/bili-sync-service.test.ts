import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder, BiliFavVideo } from './types';

const boundary = vi.hoisted(() => ({
  getBiliAuth: vi.fn(),
  fetchFavFolders: vi.fn(),
  fetchFavVideos: vi.fn(),
  getFavoriteVideoSyncBaseline: vi.fn(),
  markVideoHistoryComplete: vi.fn(),
  syncFavFoldersToDb: vi.fn(),
  syncFavVideosToDb: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('./bilibili-api', () => ({
  BiliAuthError: class BiliAuthError extends Error {},
  getBiliAuth: boundary.getBiliAuth,
  fetchFavFolders: boundary.fetchFavFolders,
  fetchFavVideos: boundary.fetchFavVideos,
}));

vi.mock('./favorites-sync', () => ({
  getFavoriteVideoSyncBaseline: boundary.getFavoriteVideoSyncBaseline,
  markVideoHistoryComplete: boundary.markVideoHistoryComplete,
  syncFavFoldersToDb: boundary.syncFavFoldersToDb,
}));

vi.mock('./videos-sync', () => ({
  syncFavVideosToDb: boundary.syncFavVideosToDb,
}));

vi.mock('@/lib/database', () => ({
  getDb: boundary.getDb,
}));

vi.mock('@/lib/embedding', () => ({
  chunkSubtitleRows: vi.fn(),
  embedPlatformItem: vi.fn(),
}));

vi.mock('@/lib/ingest/ingest', () => ({
  persistExistingItemContent: vi.fn(),
}));

import { fetchAndSyncFolders, syncAllFavoriteVideos } from './bili-sync-service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeFolder(): BiliFavFolder {
  return {
    id: 42,
    fid: 42,
    mid: 1,
    title: 'Folder',
    media_count: 2,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
  };
}

function makeVideo(bvid: string): BiliFavVideo {
  return {
    id: 1,
    type: 2,
    title: bvid,
    cover: '',
    intro: '',
    duration: 60,
    bvid,
    upper: { mid: 1, name: 'UP', face: '' },
    cnt_info: { play: 0, collect: 0, danmaku: 0 },
    fav_time: 0,
    attr: 0,
  };
}

describe('fetchAndSyncFolders', () => {
  it('checks a born-paused gate before authentication or network work', async () => {
    vi.clearAllMocks();
    const release = deferred<void>();
    const checkpoint = vi.fn(() => release.promise);
    boundary.getBiliAuth.mockResolvedValue({ sessdata: 'session', mid: '1' });
    boundary.fetchFavFolders.mockResolvedValue([]);

    const operation = fetchAndSyncFolders({ checkpoint });
    await vi.waitFor(() => expect(checkpoint).toHaveBeenCalledOnce());

    expect(boundary.getBiliAuth).not.toHaveBeenCalled();
    expect(boundary.fetchFavFolders).not.toHaveBeenCalled();

    release.resolve();
    await expect(operation).resolves.toEqual([]);
    expect(boundary.getBiliAuth).toHaveBeenCalledOnce();
    expect(boundary.fetchFavFolders).toHaveBeenCalledOnce();
  });
});

describe('syncAllFavoriteVideos', () => {
  const db = { marker: 'db' };
  const videos = [makeVideo('BV-EXISTING'), makeVideo('BV-INSERTED')];

  beforeEach(() => {
    vi.clearAllMocks();
    boundary.getBiliAuth.mockResolvedValue({ sessdata: 'session', mid: '1' });
    boundary.getDb.mockReturnValue(db);
    boundary.getFavoriteVideoSyncBaseline.mockResolvedValue({
      existingBvids: new Set(),
      historyComplete: false,
    });
    boundary.fetchFavVideos.mockResolvedValue({
      has_more: false,
      medias: videos,
      info: { id: 42, title: 'Folder', media_count: videos.length },
    });
    boundary.markVideoHistoryComplete.mockResolvedValue(undefined);
  });

  it('publishes only the item ids reported as newly inserted by persistence', async () => {
    boundary.syncFavVideosToDb.mockResolvedValue({
      total: 2,
      synced: 2,
      dropped: 0,
      droppedBvids: [],
      newItemIds: ['BV-INSERTED'],
    });
    const onItemsPersisted = vi.fn();

    await syncAllFavoriteVideos(
      [makeFolder()],
      undefined,
      undefined,
      onItemsPersisted,
    );

    expect(boundary.syncFavVideosToDb).toHaveBeenCalledWith(db, videos, '42');
    expect(onItemsPersisted).toHaveBeenCalledOnce();
    expect(onItemsPersisted.mock.calls[0][0]).toEqual([videos[1]]);
    expect(boundary.markVideoHistoryComplete).toHaveBeenCalledOnce();
  });

  it('fails Fetch and does not publish or mark history complete when persistence drops an item', async () => {
    boundary.syncFavVideosToDb.mockResolvedValue({
      total: 2,
      synced: 1,
      dropped: 1,
      droppedBvids: ['BV-INSERTED'],
      newItemIds: ['BV-EXISTING'],
    });
    const onItemsPersisted = vi.fn();

    await expect(
      syncAllFavoriteVideos(
        [makeFolder()],
        undefined,
        undefined,
        onItemsPersisted,
      ),
    ).rejects.toThrow('Failed to persist 1 Bilibili favorites for source 42');

    expect(onItemsPersisted).not.toHaveBeenCalled();
    expect(boundary.markVideoHistoryComplete).not.toHaveBeenCalled();
  });
});
