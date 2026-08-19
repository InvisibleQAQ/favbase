import { beforeEach, describe, expect, it, vi } from 'vitest';

// The registry statically imports every platform Sync Adapter (which import the
// platform libs + storage) — stub them all so the test never touches
// chrome/network/DB. The adapters' own behavior lives in their co-located
// *-sync-adapter.test.ts files; the coordinator's dispatch semantics live in
// use-daily-auto-sync.test.tsx. This file pins the registry's trigger policy.
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getXAuth: vi.fn(),
  getBiliAuth: vi.fn(),
  getPlatformLastSyncedAt: vi.fn(),
  remainingCooldown: vi.fn(),
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({ fetchAndSyncFolders: vi.fn() }));
vi.mock('@/lib/bilibili/bilibili-api', () => ({ getBiliAuth: mocks.getBiliAuth }));
vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => ({ syncBookmarks: vi.fn() }));
vi.mock('@/lib/database', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/database/collection-queries', () => ({
  getPlatformLastSyncedAt: mocks.getPlatformLastSyncedAt,
}));
vi.mock('@/lib/github/github-sync-service', () => ({ syncStars: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: mocks.getSettings },
  xLastSyncStorage: { setValue: vi.fn() },
}));
vi.mock('@/lib/x/x-auth', () => ({ getXAuth: mocks.getXAuth }));
vi.mock('@/lib/x/x-sync-service', () => ({ syncBookmarks: vi.fn() }));
vi.mock('@/lib/zhihu/zhihu-sync-service', () => ({
  syncFavorites: vi.fn(),
  ZhihuAuthError: class ZhihuAuthError extends Error {},
}));
vi.mock('@/lib/youtube/youtube-sync-service', () => ({ syncYoutubePlaylists: vi.fn() }));
vi.mock('../sections/x/cooldown', () => ({ remainingCooldown: mocks.remainingCooldown }));
vi.mock('./collection-processing-jobs', () => ({ startCollectionProcessingJobs: vi.fn() }));

import { AUTO_SYNC_PLATFORMS } from './auto-sync-registry';
import { runBilibiliSync } from '../sections/bilibili/bilibili-sync-adapter';
import { runBookmarksSync } from '../sections/bookmarks/bookmarks-sync-adapter';
import { runGithubStarsSync } from '../sections/github-stars/github-sync-adapter';
import { runXBookmarksSync } from '../sections/x/x-sync-adapter';
import { runYoutubePlaylistsSync } from '../sections/youtube/youtube-sync-adapter';
import { runZhihuFavoritesSync } from '../sections/zhihu/zhihu-sync-adapter';

function entry(jobPlatform: string) {
  const found = AUTO_SYNC_PLATFORMS.find((p) => p.jobPlatform === jobPlatform);
  if (!found) throw new Error(`registry entry missing: ${jobPlatform}`);
  return found;
}

describe('auto-sync registry', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue({});
    mocks.getXAuth.mockReset().mockResolvedValue(null);
    mocks.getBiliAuth.mockReset().mockResolvedValue(null);
    mocks.getPlatformLastSyncedAt.mockReset().mockResolvedValue(null);
    mocks.remainingCooldown.mockReset().mockReturnValue(0);
  });

  it('keeps the existing evaluation order while using a keyed registry', () => {
    expect(AUTO_SYNC_PLATFORMS.map((platform) => platform.itemPlatform)).toEqual([
      'github',
      'x',
      'zhihu',
      'youtube',
      'bookmarks',
      'bilibili',
    ]);
  });

  it('every entry runs the SAME Sync Adapter the manual page uses', () => {
    expect(entry('github-stars').runSync).toBe(runGithubStarsSync);
    expect(entry('x-bookmarks').runSync).toBe(runXBookmarksSync);
    expect(entry('zhihu-favorites').runSync).toBe(runZhihuFavoritesSync);
    expect(entry('youtube-playlists').runSync).toBe(runYoutubePlaylistsSync);
    expect(entry('bookmarks').runSync).toBe(runBookmarksSync);
    expect(entry('bilibili').runSync).toBe(runBilibiliSync);
  });

  it('github readiness = token present', async () => {
    await expect(entry('github-stars').probeReady()).resolves.toBe(false);
    mocks.getSettings.mockResolvedValue({ githubToken: 'tok' });
    await expect(entry('github-stars').probeReady()).resolves.toBe(true);
  });

  it('x readiness = captured auth present AND outside the cooldown window', async () => {
    await expect(entry('x-bookmarks').probeReady()).resolves.toBe(false);

    mocks.getXAuth.mockResolvedValue({ cookie: 'c' });
    mocks.remainingCooldown.mockReturnValue(30_000);
    await expect(entry('x-bookmarks').probeReady()).resolves.toBe(false);

    mocks.remainingCooldown.mockReturnValue(0);
    await expect(entry('x-bookmarks').probeReady()).resolves.toBe(true);
  });

  it('youtube readiness = API key + channel both configured', async () => {
    mocks.getSettings.mockResolvedValue({ youtubeApiKey: 'key' });
    await expect(entry('youtube-playlists').probeReady()).resolves.toBe(false);
    mocks.getSettings.mockResolvedValue({ youtubeApiKey: 'key', youtubeChannel: '@c' });
    await expect(entry('youtube-playlists').probeReady()).resolves.toBe(true);
  });

  it('bilibili readiness = logged-in cookie session', async () => {
    await expect(entry('bilibili').probeReady()).resolves.toBe(false);
    mocks.getBiliAuth.mockResolvedValue({ SESSDATA: 's' });
    await expect(entry('bilibili').probeReady()).resolves.toBe(true);
  });

  it('zhihu + bookmarks are always ready (cookie jar / local data)', async () => {
    await expect(entry('zhihu-favorites').probeReady()).resolves.toBe(true);
    await expect(entry('bookmarks').probeReady()).resolves.toBe(true);
  });

  it('only zhihu treats its logged-out error as silent', async () => {
    const { ZhihuAuthError } = await import('@/lib/zhihu/zhihu-sync-service');
    expect(entry('zhihu-favorites').isSilentError?.(new ZhihuAuthError('out'))).toBe(true);
    expect(entry('zhihu-favorites').isSilentError?.(new Error('boom'))).toBe(false);
    for (const p of AUTO_SYNC_PLATFORMS.filter((p) => p.jobPlatform !== 'zhihu-favorites')) {
      expect(p.isSilentError).toBeUndefined();
    }
  });
});
