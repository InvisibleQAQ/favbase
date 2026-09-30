import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  syncBookmarks: vi.fn(),
  startBookmarkExtraction: vi.fn(),
  runPlatformSync: vi.fn(),
}));

vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => ({ syncBookmarks: mocks.syncBookmarks }));
vi.mock('./use-bookmark-extraction', () => ({
  startBookmarkExtraction: mocks.startBookmarkExtraction,
}));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { runBookmarksSync, type BookmarksSyncProgress } from './bookmarks-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
let outcome: PlatformSyncOutcome | undefined;

describe('bookmarks Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.syncBookmarks.mockReset().mockResolvedValue({ totalBookmarks: 3, inserted: 2 });
    mocks.startBookmarkExtraction.mockReset();
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('runs the tree sync inside the funnel and reports indeterminate progress around it', async () => {
    const progress: BookmarksSyncProgress[] = [];

    await runBookmarksSync((p) => progress.push(p), control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('bookmarks', control, expect.any(Function));
    expect(mocks.syncBookmarks).toHaveBeenCalledWith(control);
    expect(progress).toEqual([
      { done: 0, total: null },
      { done: 3, total: null },
    ]);
  });

  it('reports bookmarks read and items inserted; no batch tag ids (extraction processes per item)', async () => {
    await runBookmarksSync(() => undefined, control);

    expect(outcome).toEqual({ fetched: 3, inserted: 2, newItemIds: [] });
  });

  it('chains content extraction only after the funnel returned', async () => {
    let funnelDone = false;
    mocks.runPlatformSync.mockImplementation(
      async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        await sync();
        expect(mocks.startBookmarkExtraction).not.toHaveBeenCalled();
        funnelDone = true;
      },
    );
    mocks.startBookmarkExtraction.mockImplementation(() => {
      expect(funnelDone).toBe(true);
    });

    await runBookmarksSync(() => undefined, control);

    expect(mocks.startBookmarkExtraction).toHaveBeenCalledTimes(1);
  });

  it('chains nothing when the funnel throws', async () => {
    mocks.runPlatformSync.mockRejectedValue(new Error('tree read failed'));

    await expect(runBookmarksSync(() => undefined, control)).rejects.toThrow('tree read failed');
    expect(mocks.startBookmarkExtraction).not.toHaveBeenCalled();
  });
});
