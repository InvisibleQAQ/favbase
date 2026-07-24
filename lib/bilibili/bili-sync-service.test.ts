import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavVideo } from './types';
import type { SyncResult } from './videos-sync';

const boundary = vi.hoisted(() => ({
  getBiliAuth: vi.fn(),
  fetchFavFolders: vi.fn(),
  fetchFavVideos: vi.fn(),
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
  getFavoriteVideoSyncBaseline: vi.fn(),
  markVideoHistoryComplete: vi.fn(),
  syncFavFoldersToDb: vi.fn(),
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

import { fetchAndSyncVideos } from './bili-sync-service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const VIDEO: BiliFavVideo = {
  id: 1,
  type: 2,
  title: 'Page one video',
  cover: '',
  intro: '',
  duration: 60,
  bvid: 'BV-PAGE-1',
  upper: { mid: 1, name: 'UP', face: '' },
  cnt_info: { play: 0, collect: 0, danmaku: 0 },
  fav_time: 0,
  attr: 0,
};

function sourceDb(rows: Array<{ id: string; platformMeta: Record<string, unknown> }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  };
}

describe('fetchAndSyncVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.getBiliAuth.mockResolvedValue({ sessdata: 'session', mid: '1' });
    boundary.fetchFavVideos.mockResolvedValue({
      has_more: false,
      medias: [VIDEO],
      info: { id: 42, title: 'Folder', media_count: 1 },
    });
    boundary.getDb.mockReturnValue(sourceDb([{ id: 'source-id', platformMeta: {} }]));
  });

  it('does not resolve before the fetched page is persisted', async () => {
    const persistence = deferred<SyncResult>();
    boundary.syncFavVideosToDb.mockReturnValueOnce(persistence.promise);

    const operation = fetchAndSyncVideos(42, 1);
    let settled = false;
    void operation.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await vi.waitFor(() => expect(boundary.syncFavVideosToDb).toHaveBeenCalledOnce());
    await Promise.resolve();
    const settledBeforePersistence = settled;

    persistence.resolve({ total: 1, synced: 1, dropped: 0, droppedBvids: [] });
    await operation;

    expect(settledBeforePersistence).toBe(false);
  });

  it('rejects when persistence drops a fetched video', async () => {
    boundary.syncFavVideosToDb.mockResolvedValueOnce({
      total: 1,
      synced: 0,
      dropped: 1,
      droppedBvids: [VIDEO.bvid],
    });

    await expect(fetchAndSyncVideos(42, 1)).rejects.toThrow(
      'Failed to persist 1 Bilibili favorites for source 42',
    );
  });

  it('rejects when the fetched page has no source to persist into', async () => {
    boundary.getDb.mockReturnValueOnce(sourceDb([]));

    await expect(fetchAndSyncVideos(42, 1)).rejects.toThrow(
      'Cannot persist Bilibili favorites: source 42 not found',
    );
    expect(boundary.syncFavVideosToDb).not.toHaveBeenCalled();
  });
});
