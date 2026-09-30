import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  syncYoutubePlaylists: vi.fn(),
  getSettings: vi.fn(),
  runPlatformSync: vi.fn(),
}));

vi.mock('@/lib/youtube/youtube-sync-service', () => ({
  syncYoutubePlaylists: mocks.syncYoutubePlaylists,
}));
// Real module runs storage.defineItem (chrome.storage) at load.
vi.mock('@/lib/storage', () => ({ settingsStorage: { getValue: mocks.getSettings } }));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { runYoutubePlaylistsSync } from './youtube-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
let outcome: PlatformSyncOutcome | undefined;

describe('youtube Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.getSettings
      .mockReset()
      .mockResolvedValue({ youtubeApiKey: 'key', youtubeChannel: '@chan' });
    mocks.syncYoutubePlaylists
      .mockReset()
      .mockResolvedValue({ playlists: 0, entries: 0, inserted: 0, newItemIds: [] });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('is a silent no-op without complete config (never reaches the funnel)', async () => {
    mocks.getSettings.mockResolvedValue({ youtubeApiKey: 'key' });

    await runYoutubePlaylistsSync(() => undefined, control);

    expect(mocks.runPlatformSync).not.toHaveBeenCalled();
    expect(mocks.syncYoutubePlaylists).not.toHaveBeenCalled();
  });

  it('runs the domain sync inside the funnel with the API key + channel and the checkpoint', async () => {
    await runYoutubePlaylistsSync(() => undefined, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('youtube', control, expect.any(Function));
    expect(mocks.syncYoutubePlaylists).toHaveBeenCalledWith(
      { apiKey: 'key', channel: '@chan' },
      expect.any(Function),
      control,
    );
  });

  it('reports membership entries, items inserted and the persisted ids to the funnel', async () => {
    mocks.syncYoutubePlaylists.mockResolvedValue({
      playlists: 2,
      entries: 7,
      inserted: 2,
      newItemIds: ['v1', 'v2'],
    });

    await runYoutubePlaylistsSync(() => undefined, control);

    expect(outcome).toEqual({ fetched: 7, inserted: 2, newItemIds: ['v1', 'v2'] });
  });
});
