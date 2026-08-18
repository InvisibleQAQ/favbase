import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  syncBookmarks: vi.fn(),
  startBookmarkExtraction: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => ({ syncBookmarks: mocks.syncBookmarks }));
vi.mock('./use-bookmark-extraction', () => ({
  startBookmarkExtraction: mocks.startBookmarkExtraction,
}));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runBookmarksSync, type BookmarksSyncProgress } from './bookmarks-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };

describe('bookmarks Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    mocks.syncBookmarks.mockReset().mockResolvedValue({ totalBookmarks: 3 });
    mocks.startBookmarkExtraction.mockReset();
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('reports indeterminate progress around the tree sync', async () => {
    const progress: BookmarksSyncProgress[] = [];

    await runBookmarksSync((p) => progress.push(p), control);

    expect(mocks.syncBookmarks).toHaveBeenCalledWith(control);
    expect(progress).toEqual([
      { done: 0, total: null },
      { done: 3, total: null },
    ]);
  });

  it('chains content extraction after a successful sync', async () => {
    await runBookmarksSync(() => undefined, control);

    expect(mocks.startBookmarkExtraction).toHaveBeenCalledTimes(1);
  });

  it('dispatches the backlog embed lane (empty ids) after a successful sync', async () => {
    await runBookmarksSync(() => undefined, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'bookmarks',
      itemPlatform: 'bookmarks',
      itemIds: [],
    });
  });

  it('chains nothing when the sync fails', async () => {
    mocks.syncBookmarks.mockRejectedValue(new Error('tree read failed'));

    await expect(runBookmarksSync(() => undefined, control)).rejects.toThrow('tree read failed');
    expect(mocks.startBookmarkExtraction).not.toHaveBeenCalled();
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
