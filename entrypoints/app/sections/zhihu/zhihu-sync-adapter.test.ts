import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  syncFavorites: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/zhihu/zhihu-sync-service', () => ({
  syncFavorites: mocks.syncFavorites,
  ZhihuAuthError: class ZhihuAuthError extends Error {},
}));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runZhihuFavoritesSync, type ZhihuSyncProgress } from './zhihu-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };

describe('zhihu Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    mocks.syncFavorites.mockReset().mockResolvedValue({ newItemIds: [] });
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('passes the checkpoint through to the domain sync (cookie auth, nothing to resolve)', async () => {
    await runZhihuFavoritesSync(() => undefined, control);

    expect(mocks.syncFavorites).toHaveBeenCalledWith(expect.any(Function), control);
  });

  it('maps collection-cursor progress (initial zero seed + per-page updates)', async () => {
    const progress: ZhihuSyncProgress[] = [];
    mocks.syncFavorites.mockImplementation(
      async (onPage: (fetchedCount: number, current: number, total: number) => void) => {
        onPage(12, 1, 3);
        onPage(20, 2, 3);
        return { newItemIds: [] };
      },
    );

    await runZhihuFavoritesSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { fetchedCount: 0, current: 0, total: 0 },
      { fetchedCount: 12, current: 1, total: 3 },
      { fetchedCount: 20, current: 2, total: 3 },
    ]);
  });

  it('dispatches embed/tag processing with the newly persisted ids', async () => {
    mocks.syncFavorites.mockResolvedValue({ newItemIds: ['z1'] });

    await runZhihuFavoritesSync(() => undefined, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'zhihu-favorites',
      itemPlatform: 'zhihu',
      itemIds: ['z1'],
    });
  });

  it('does not dispatch processing when the sync fails (e.g. logged out)', async () => {
    mocks.syncFavorites.mockRejectedValue(new Error('not logged in'));

    await expect(runZhihuFavoritesSync(() => undefined, control)).rejects.toThrow('not logged in');
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
