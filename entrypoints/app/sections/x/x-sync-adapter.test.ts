import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  getXAuth: vi.fn(),
  syncBookmarks: vi.fn(),
  setLastSync: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/x/x-auth', () => ({ getXAuth: mocks.getXAuth }));
vi.mock('@/lib/x/x-sync-service', () => ({ syncBookmarks: mocks.syncBookmarks }));
// Real module runs storage.defineItem (chrome.storage) at load.
vi.mock('@/lib/storage', () => ({ xLastSyncStorage: { setValue: mocks.setLastSync } }));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runXBookmarksSync, type XSyncProgress } from './x-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const AUTH = { cookie: 'c', csrf: 't', bearer: 'b' };

describe('x Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    mocks.getXAuth.mockReset().mockResolvedValue(AUTH);
    mocks.syncBookmarks.mockReset().mockResolvedValue({ newItemIds: [], inserted: 0 });
    mocks.setLastSync.mockReset();
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('resolves the captured session auth and passes the checkpoint through', async () => {
    await runXBookmarksSync(() => undefined, control);

    expect(mocks.syncBookmarks).toHaveBeenCalledWith(AUTH, expect.any(Function), control);
  });

  it('maps cursor progress (initial zero seed + per-page updates)', async () => {
    const progress: XSyncProgress[] = [];
    mocks.syncBookmarks.mockImplementation(
      async (_auth: unknown, onPage: (fetchedCount: number, page: number) => void) => {
        onPage(20, 1);
        onPage(37, 2);
        return { newItemIds: [], inserted: 0 };
      },
    );

    await runXBookmarksSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { fetchedCount: 0, page: 0 },
      { fetchedCount: 20, page: 1 },
      { fetchedCount: 37, page: 2 },
    ]);
  });

  it('dispatches embed/tag processing with the newly persisted ids', async () => {
    mocks.syncBookmarks.mockResolvedValue({ newItemIds: ['t1', 't2'], inserted: 2 });

    await runXBookmarksSync(() => undefined, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'x-bookmarks',
      itemPlatform: 'x',
      itemIds: ['t1', 't2'],
    });
  });

  it('persists the "N new this run" summary on EVERY successful sync (audit #6 drift)', async () => {
    mocks.syncBookmarks.mockResolvedValue({ newItemIds: ['t1'], inserted: 5 });

    await runXBookmarksSync(() => undefined, control);

    expect(mocks.setLastSync).toHaveBeenCalledWith({
      syncedAt: expect.any(Number),
      inserted: 5,
    });
  });

  it('writes no summary and dispatches nothing when the sync fails', async () => {
    mocks.syncBookmarks.mockRejectedValue(new Error('auth expired'));

    await expect(runXBookmarksSync(() => undefined, control)).rejects.toThrow('auth expired');
    expect(mocks.setLastSync).not.toHaveBeenCalled();
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
