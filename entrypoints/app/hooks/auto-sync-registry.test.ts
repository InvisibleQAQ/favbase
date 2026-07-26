import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

// The registry statically imports every platform lib — stub them all so the
// test never touches chrome/network/DB. Only the bookmarks/bilibili entries
// (content-stage auto-continuation) are exercised here; the coordinator's
// dispatch semantics live in use-daily-auto-sync.test.tsx.
const mocks = vi.hoisted(() => ({
  fetchAndSyncFolders: vi.fn(),
  syncAllFavoriteVideos: vi.fn(),
  syncBrowserBookmarks: vi.fn(),
  startBookmarkExtraction: vi.fn(),
  startBiliAutoTranscribe: vi.fn(),
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  fetchAndSyncFolders: mocks.fetchAndSyncFolders,
  syncAllFavoriteVideos: mocks.syncAllFavoriteVideos,
}));
vi.mock('@/lib/bilibili/bilibili-api', () => ({ getBiliAuth: vi.fn() }));
vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => ({
  syncBookmarks: mocks.syncBrowserBookmarks,
}));
vi.mock('@/lib/database', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/database/collection-queries', () => ({ getPlatformLastSyncedAt: vi.fn() }));
vi.mock('@/lib/github/github-sync-service', () => ({ syncStars: vi.fn() }));
vi.mock('@/lib/storage', () => ({ settingsStorage: { getValue: vi.fn(async () => ({})) } }));
vi.mock('@/lib/x/x-auth', () => ({ getXAuth: vi.fn() }));
vi.mock('@/lib/x/x-sync-service', () => ({ syncBookmarks: vi.fn() }));
vi.mock('@/lib/zhihu/zhihu-sync-service', () => ({
  syncFavorites: vi.fn(),
  ZhihuAuthError: class ZhihuAuthError extends Error {},
}));
vi.mock('@/lib/youtube/youtube-sync-service', () => ({ syncYoutubePlaylists: vi.fn() }));
vi.mock('../sections/x/cooldown', () => ({ remainingCooldown: vi.fn(() => 0) }));
vi.mock('../sections/bookmarks/use-bookmark-extraction', () => ({
  startBookmarkExtraction: mocks.startBookmarkExtraction,
}));
vi.mock('../sections/bilibili/auto-transcribe-runtime', () => ({
  startBiliAutoTranscribe: mocks.startBiliAutoTranscribe,
}));

import { AUTO_SYNC_PLATFORMS } from './auto-sync-registry';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const noProgress = (): void => undefined;

function entry(jobPlatform: string) {
  const found = AUTO_SYNC_PLATFORMS.find((p) => p.jobPlatform === jobPlatform);
  if (!found) throw new Error(`registry entry missing: ${jobPlatform}`);
  return found;
}

describe('auto-sync registry content-stage chaining', () => {
  beforeEach(() => {
    mocks.fetchAndSyncFolders.mockReset();
    mocks.syncAllFavoriteVideos.mockReset().mockResolvedValue({ fetchedCount: 0 });
    mocks.syncBrowserBookmarks.mockReset().mockResolvedValue({ totalBookmarks: 3 });
    mocks.startBookmarkExtraction.mockReset();
    mocks.startBiliAutoTranscribe.mockReset();
  });

  it('bookmarks: chains content extraction after a successful sync, still returning []', async () => {
    const ids = await entry('bookmarks').runSync(noProgress, control);

    expect(mocks.syncBrowserBookmarks).toHaveBeenCalledWith(control);
    expect(mocks.startBookmarkExtraction).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([]); // extraction enqueues embed/tag per item itself
  });

  it('bookmarks: does not chain extraction when the sync fails', async () => {
    mocks.syncBrowserBookmarks.mockRejectedValue(new Error('tree read failed'));

    await expect(entry('bookmarks').runSync(noProgress, control)).rejects.toThrow(
      'tree read failed',
    );
    expect(mocks.startBookmarkExtraction).not.toHaveBeenCalled();
  });

  it('bilibili: chains a batch transcription for the default folder, still returning []', async () => {
    mocks.fetchAndSyncFolders.mockResolvedValue([{ id: 42 }, { id: 43 }]);

    const ids = await entry('bilibili').runSync(noProgress, control);

    expect(mocks.syncAllFavoriteVideos).toHaveBeenCalledWith(
      [{ id: 42 }, { id: 43 }],
      noProgress,
      control,
    );
    expect(mocks.startBiliAutoTranscribe).toHaveBeenCalledTimes(1);
    expect(mocks.startBiliAutoTranscribe).toHaveBeenCalledWith('42');
    expect(ids).toEqual([]); // transcription enqueues embed/tag per item itself
  });

  it('bilibili: starts no transcription when the account has zero folders', async () => {
    mocks.fetchAndSyncFolders.mockResolvedValue([]);

    await entry('bilibili').runSync(noProgress, control);

    expect(mocks.startBiliAutoTranscribe).not.toHaveBeenCalled();
  });
});
