import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  syncYoutubePlaylists: vi.fn(),
  getSettings: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/youtube/youtube-sync-service', () => ({
  syncYoutubePlaylists: mocks.syncYoutubePlaylists,
}));
// Real module runs storage.defineItem (chrome.storage) at load.
vi.mock('@/lib/storage', () => ({ settingsStorage: { getValue: mocks.getSettings } }));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runYoutubePlaylistsSync } from './youtube-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };

describe('youtube Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    mocks.getSettings
      .mockReset()
      .mockResolvedValue({ youtubeApiKey: 'key', youtubeChannel: '@chan' });
    mocks.syncYoutubePlaylists.mockReset().mockResolvedValue({ newItemIds: [] });
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('is a silent no-op without complete config (no domain sync, no dispatch)', async () => {
    mocks.getSettings.mockResolvedValue({ youtubeApiKey: 'key' });

    await runYoutubePlaylistsSync(() => undefined, control);

    expect(mocks.syncYoutubePlaylists).not.toHaveBeenCalled();
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });

  it('resolves the API key + channel from settings and passes the checkpoint through', async () => {
    await runYoutubePlaylistsSync(() => undefined, control);

    expect(mocks.syncYoutubePlaylists).toHaveBeenCalledWith(
      { apiKey: 'key', channel: '@chan' },
      expect.any(Function),
      control,
    );
  });

  it('dispatches embed/tag processing with the newly persisted ids', async () => {
    mocks.syncYoutubePlaylists.mockResolvedValue({ newItemIds: ['v1', 'v2'] });

    await runYoutubePlaylistsSync(() => undefined, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'youtube-playlists',
      itemPlatform: 'youtube',
      itemIds: ['v1', 'v2'],
    });
  });

  it('does not dispatch processing when the sync fails', async () => {
    mocks.syncYoutubePlaylists.mockRejectedValue(new Error('quota'));

    await expect(runYoutubePlaylistsSync(() => undefined, control)).rejects.toThrow('quota');
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
