import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  extractPendingBookmarks: vi.fn(),
}));

const processingMocks = vi.hoisted(() => ({
  enqueueCollectionProcessingItem: vi.fn(),
}));

vi.mock('@/lib/database', () => ({
  initDbProxy: vi.fn(async () => ({})),
}));

vi.mock('@/lib/bookmarks/bookmark-content-service', () => serviceMocks);

vi.mock('@/lib/bookmarks/bookmarks-sync-service', () => ({
  countPendingExtractions: vi.fn(async () => 0),
}));

vi.mock('@/lib/embedding', () => ({
  embedNewItems: vi.fn(async () => undefined),
}));

vi.mock('@/lib/tagging', () => ({
  tagNewItems: vi.fn(async () => undefined),
}));

vi.mock('../../hooks/collection-processing-jobs', () => processingMocks);

import { getJob, startJob } from '../../hooks/background-jobs-store';
import { startBookmarkExtraction } from './use-bookmark-extraction';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('bookmark extraction job ownership', () => {
  beforeEach(() => {
    serviceMocks.extractPendingBookmarks.mockReset().mockResolvedValue(undefined);
    processingMocks.enqueueCollectionProcessingItem.mockReset();
  });

  it('starts extraction while bookmark metadata sync is still running', async () => {
    const metadataSync = deferred();
    startJob('bookmarks', 'sync', () => metadataSync.promise);

    startBookmarkExtraction();
    await flush();

    expect(serviceMocks.extractPendingBookmarks).toHaveBeenCalledTimes(1);
    // The shared cooperative checkpoint reaches the worker — this is what lets
    // the library gate pause the run between items.
    expect(serviceMocks.extractPendingBookmarks).toHaveBeenCalledWith(
      expect.objectContaining({
        control: expect.objectContaining({ checkpoint: expect.any(Function) }),
      }),
    );

    metadataSync.resolve();
    await flush();
  });

  it('enqueues each extracted item without waiting for processing lanes', async () => {
    const never = new Promise<never>(() => undefined);
    processingMocks.enqueueCollectionProcessingItem.mockReturnValue({
      embed: never,
      tag: never,
    });
    serviceMocks.extractPendingBookmarks.mockImplementation(
      async (options: { onItemExtracted?: (id: string) => void }) => {
        options.onItemExtracted?.('bookmark-1');
      },
    );

    startBookmarkExtraction();
    await flush();

    expect(processingMocks.enqueueCollectionProcessingItem).toHaveBeenCalledWith({
      jobPlatform: 'bookmarks',
      itemPlatform: 'bookmarks',
      itemId: 'bookmark-1',
    });
    expect(getJob('bookmarks', 'extract')?.phase).toBe('completed');
  });
});
