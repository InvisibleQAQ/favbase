import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  syncStars: vi.fn(),
  getSettings: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/github/github-sync-service', () => ({ syncStars: mocks.syncStars }));
// Real module runs storage.defineItem (chrome.storage) at load.
vi.mock('@/lib/storage', () => ({ settingsStorage: { getValue: mocks.getSettings } }));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runGithubStarsSync, type SyncProgress } from './github-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };

describe('github Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset().mockResolvedValue({ githubToken: 'tok' });
    mocks.syncStars.mockReset().mockResolvedValue({ newItemIds: [] });
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('is a silent no-op without a token (no domain sync, no dispatch)', async () => {
    mocks.getSettings.mockResolvedValue({});

    await runGithubStarsSync(() => undefined, control);

    expect(mocks.syncStars).not.toHaveBeenCalled();
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });

  it('resolves the token from settings and passes the checkpoint through', async () => {
    await runGithubStarsSync(() => undefined, control);

    expect(mocks.syncStars).toHaveBeenCalledWith(
      'tok',
      expect.any(Function),
      expect.any(Function),
      control,
    );
  });

  it('maps stars + readme progress; readme keeps the final fetched count', async () => {
    const progress: SyncProgress[] = [];
    mocks.syncStars.mockImplementation(
      async (
        _token: string,
        onStars: (page: number, totalPages: number, fetchedCount: number) => void,
        onReadme: (done: number, total: number) => void,
      ) => {
        onStars(1, 2, 30);
        onStars(2, 2, 55);
        onReadme(1, 3);
        return { newItemIds: [] };
      },
    );

    await runGithubStarsSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { phase: 'stars', page: 0, totalPages: 0, fetchedCount: 0, estimatedTotal: 0 },
      { phase: 'stars', page: 1, totalPages: 2, fetchedCount: 30, estimatedTotal: 60 },
      { phase: 'stars', page: 2, totalPages: 2, fetchedCount: 55, estimatedTotal: 55 },
      { phase: 'readme', done: 1, total: 3, fetchedCount: 55 },
    ]);
  });

  it('dispatches embed/tag processing with the newly persisted ids', async () => {
    mocks.syncStars.mockResolvedValue({ newItemIds: ['a', 'b'] });

    await runGithubStarsSync(() => undefined, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'github-stars',
      itemPlatform: 'github',
      itemIds: ['a', 'b'],
    });
  });

  it('does not dispatch processing when the sync fails', async () => {
    mocks.syncStars.mockRejectedValue(new Error('rate limited'));

    await expect(runGithubStarsSync(() => undefined, control)).rejects.toThrow('rate limited');
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
