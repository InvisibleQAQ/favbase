import { describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder, BiliFavVideo } from './types';
import {
  favoritePageDelayMs,
  runFavoriteVideosSync,
  type BiliFavoritesSyncProgress,
  type FavoriteVideosSyncDeps,
} from './favorites-sync-runner';

function makeFolder(overrides: Partial<BiliFavFolder> = {}): BiliFavFolder {
  return {
    id: 10,
    fid: 10,
    mid: 1,
    title: 'Folder A',
    media_count: 5,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
    ...overrides,
  };
}

function makeVideo(bvid: string): BiliFavVideo {
  return {
    id: Number(bvid.replace(/\D/g, '')) || 1,
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

describe('runFavoriteVideosSync', () => {
  it('checks for a cooperative pause before claiming a folder and its page', async () => {
    const checkpoint = vi.fn(async () => undefined);
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({ existingBvids: new Set(), historyComplete: false }),
      fetchPage: async () => ({
        videos: [makeVideo('BV1')],
        totalPages: 1,
        hasMore: false,
      }),
      persist: async () => undefined,
      markHistoryComplete: async () => undefined,
      waitBetweenPages: async () => undefined,
    };

    await runFavoriteVideosSync(
      [makeFolder()],
      deps,
      undefined,
      { checkpoint },
    );

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });

  it('persists and publishes each page before fetching the next page', async () => {
    const events: string[] = [];
    const pages = [
      { videos: [makeVideo('BV1'), makeVideo('BV2')], totalPages: 3, hasMore: true },
      { videos: [makeVideo('BV3'), makeVideo('BV4')], totalPages: 3, hasMore: true },
      { videos: [makeVideo('BV5')], totalPages: 3, hasMore: false },
    ];
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({
        existingBvids: new Set(['BV1', 'BV2']),
        historyComplete: false,
      }),
      fetchPage: async (_folder, page) => {
        events.push(`fetch:${page}`);
        return pages[page - 1];
      },
      persist: async (_folder, videos) => {
        events.push(`persist:${videos.map((video) => video.bvid).join(',')}`);
        return videos.map((video) => video.bvid);
      },
      markHistoryComplete: async () => {
        events.push('mark-complete');
      },
      waitBetweenPages: async () => {
        events.push('wait');
      },
    };

    const result = await runFavoriteVideosSync(
      [makeFolder()],
      deps,
      undefined,
      undefined,
      (videos) => events.push(`publish:${videos.map((video) => video.bvid).join(',')}`),
    );

    expect(events).toEqual([
      'fetch:1',
      'persist:BV1,BV2',
      'publish:BV1,BV2',
      'wait',
      'fetch:2',
      'persist:BV3,BV4',
      'publish:BV3,BV4',
      'wait',
      'fetch:3',
      'persist:BV5',
      'publish:BV5',
      'mark-complete',
    ]);
    expect(result).toEqual({ fetchedCount: 5, syncedCount: 5 });
  });

  it('stops a completed history at the first source-existing BVID', async () => {
    const fetchedPages: number[] = [];
    const persisted: string[][] = [];
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({
        existingBvids: new Set(['bv-old']),
        historyComplete: true,
      }),
      fetchPage: async (_folder, page) => {
        fetchedPages.push(page);
        return {
          videos: [makeVideo('BV-NEW'), makeVideo('BV-OLD'), makeVideo('BV-AFTER-OLD')],
          totalPages: 3,
          hasMore: true,
        };
      },
      persist: async (_folder, videos) => {
        persisted.push(videos.map((video) => video.bvid));
      },
      markHistoryComplete: async () => undefined,
      waitBetweenPages: async () => undefined,
    };

    const result = await runFavoriteVideosSync([makeFolder()], deps);

    expect(fetchedPages).toEqual([1]);
    expect(persisted).toEqual([['BV-NEW']]);
    expect(result).toEqual({ fetchedCount: 3, syncedCount: 1 });
  });

  it('keeps earlier pages durable but does not mark the Source when a later page fails', async () => {
    const persisted: string[] = [];
    const published: string[] = [];
    let markedComplete = false;
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({ existingBvids: new Set(), historyComplete: false }),
      fetchPage: async (_folder, page) => {
        if (page === 2) throw new Error('page 2 failed');
        return {
          videos: [makeVideo('BV1'), makeVideo('BV2')],
          totalPages: 2,
          hasMore: true,
        };
      },
      persist: async (_folder, videos) => {
        const ids = videos.map((video) => video.bvid);
        persisted.push(...ids);
        return ids;
      },
      markHistoryComplete: async () => {
        markedComplete = true;
      },
      waitBetweenPages: async () => undefined,
    };

    await expect(
      runFavoriteVideosSync(
        [makeFolder()],
        deps,
        undefined,
        undefined,
        (videos) => published.push(...videos.map((video) => video.bvid)),
      ),
    ).rejects.toThrow('page 2 failed');
    expect(persisted).toEqual(['BV1', 'BV2']);
    expect(published).toEqual(['BV1', 'BV2']);
    expect(markedComplete).toBe(false);
  });

  it('contains a persisted-item subscriber failure instead of failing Fetch', async () => {
    let markedComplete = false;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({ existingBvids: new Set(), historyComplete: false }),
      fetchPage: async () => ({
        videos: [makeVideo('BV1')],
        totalPages: 1,
        hasMore: false,
      }),
      persist: async () => ['BV1'],
      markHistoryComplete: async () => {
        markedComplete = true;
      },
      waitBetweenPages: async () => undefined,
    };

    try {
      await expect(
        runFavoriteVideosSync(
          [makeFolder()],
          deps,
          undefined,
          undefined,
          () => {
            throw new Error('subscriber failed');
          },
        ),
      ).resolves.toEqual({ fetchedCount: 1, syncedCount: 1 });
      expect(markedComplete).toBe(true);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('observes an async persisted-item subscriber rejection without failing Fetch', async () => {
    let markedComplete = false;
    const subscriberError = new Error('async subscriber failed');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({ existingBvids: new Set(), historyComplete: false }),
      fetchPage: async () => ({
        videos: [makeVideo('BV1')],
        totalPages: 1,
        hasMore: false,
      }),
      persist: async () => ['BV1'],
      markHistoryComplete: async () => {
        markedComplete = true;
      },
      waitBetweenPages: async () => undefined,
    };

    try {
      await expect(
        runFavoriteVideosSync(
          [makeFolder()],
          deps,
          undefined,
          undefined,
          async () => { throw subscriberError; },
        ),
      ).resolves.toEqual({ fetchedCount: 1, syncedCount: 1 });
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          '[bili-sync] persisted-item subscriber failed:',
          subscriberError,
        );
      });
      expect(markedComplete).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('syncs every folder and reports cumulative folder-page progress', async () => {
    const folders = [
      makeFolder({ id: 10, title: 'Folder A', media_count: 1 }),
      makeFolder({ id: 20, title: 'Folder B', media_count: 1 }),
    ];
    const persistedFolders: number[] = [];
    const progress: BiliFavoritesSyncProgress[] = [];
    const deps: FavoriteVideosSyncDeps = {
      getBaseline: async () => ({ existingBvids: new Set(), historyComplete: false }),
      fetchPage: async (folder) => ({
        videos: [makeVideo(`BV${folder.id}`)],
        totalPages: 1,
        hasMore: false,
      }),
      persist: async (folder) => {
        persistedFolders.push(folder.id);
      },
      markHistoryComplete: async () => undefined,
      waitBetweenPages: async () => undefined,
    };

    const result = await runFavoriteVideosSync(folders, deps, (value) => progress.push(value));

    expect(persistedFolders).toEqual([10, 20]);
    expect(progress).toEqual([
      {
        fetchedCount: 1,
        folderIndex: 1,
        folderCount: 2,
        folderTitle: 'Folder A',
        page: 1,
        totalPages: 1,
      },
      {
        fetchedCount: 2,
        folderIndex: 2,
        folderCount: 2,
        folderTitle: 'Folder B',
        page: 1,
        totalPages: 1,
      },
    ]);
    expect(result).toEqual({ fetchedCount: 2, syncedCount: 2 });
  });
});

describe('favoritePageDelayMs', () => {
  it('maps jitter to the configured 7-10 second page delay', () => {
    expect(favoritePageDelayMs(() => 0)).toBe(7_000);
    expect(favoritePageDelayMs(() => 0.5)).toBe(8_500);
    expect(favoritePageDelayMs(() => 1)).toBe(10_000);
  });
});
