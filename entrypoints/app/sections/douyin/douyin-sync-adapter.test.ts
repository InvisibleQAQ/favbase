import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';
import type { DouyinBackfillState, SyncDouyinOptions } from '@/lib/douyin/douyin-sync-service';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  findDouyinTab: vi.fn(),
  transport: vi.fn(),
  syncDouyinCollections: vi.fn(),
  runPlatformSync: vi.fn(),
  enqueue: vi.fn(),
  getBackfill: vi.fn(),
  setBackfill: vi.fn(),
  DouyinAuthError: class DouyinAuthError extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/douyin/douyin-tab', () => ({
  findDouyinTab: mocks.findDouyinTab,
  douyinTabTransport: mocks.transport,
}));
vi.mock('@/lib/douyin/douyin-sync-service', () => ({
  syncDouyinCollections: mocks.syncDouyinCollections,
  DouyinAuthError: mocks.DouyinAuthError,
}));
vi.mock('@/lib/storage', () => ({
  douyinBackfillStorage: { getValue: mocks.getBackfill, setValue: mocks.setBackfill },
}));
vi.mock('../../hooks/collection-processing-jobs', () => ({
  enqueueCollectionProcessingItem: mocks.enqueue,
}));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import {
  douyinAutoSyncPolicy,
  runDouyinSync,
  type DouyinSyncProgress,
} from './douyin-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const STORED: DouyinBackfillState = { resumeCursor: '1789911201230543', backfillDone: false };
let outcome: PlatformSyncOutcome | undefined;

function syncOptions(): SyncDouyinOptions {
  return mocks.syncDouyinCollections.mock.calls[0][1] as SyncDouyinOptions;
}

describe('douyin Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.findDouyinTab.mockReset().mockResolvedValue(11);
    mocks.getBackfill.mockReset().mockResolvedValue(STORED);
    mocks.setBackfill.mockReset().mockResolvedValue(undefined);
    mocks.enqueue.mockReset();
    mocks.syncDouyinCollections
      .mockReset()
      .mockResolvedValue({ fetched: 0, inserted: 0, folders: 0, newItemIds: [] });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('throws the missing auth error BEFORE the funnel when no usable douyin.com tab is open (F1)', async () => {
    mocks.findDouyinTab.mockResolvedValue(null);

    const run = runDouyinSync(() => undefined, control);

    await expect(run).rejects.toBeInstanceOf(mocks.DouyinAuthError);
    await expect(run).rejects.toMatchObject({ reason: 'missing' });
    // Not an attempt: no Platform Sync Record, the platform never contacted,
    // the breakpoint never read.
    expect(mocks.runPlatformSync).not.toHaveBeenCalled();
    expect(mocks.syncDouyinCollections).not.toHaveBeenCalled();
    expect(mocks.getBackfill).not.toHaveBeenCalled();
  });

  it('runs the domain sync inside the funnel through the tab transport, with the stored breakpoint and the checkpoint', async () => {
    await runDouyinSync(() => undefined, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('douyin', control, expect.any(Function));
    expect(mocks.syncDouyinCollections).toHaveBeenCalledTimes(1);
    expect(mocks.syncDouyinCollections.mock.calls[0][0]).toBe(mocks.transport);
    expect(syncOptions()).toMatchObject({ backfill: STORED, control });
  });

  it('writes every breakpoint change back to storage', async () => {
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      await opts.onBackfill?.({ resumeCursor: '1789000000000000', backfillDone: false });
      await opts.onBackfill?.({ resumeCursor: null, backfillDone: true });
      return { fetched: 40, inserted: 40, folders: 0, newItemIds: [] };
    });

    await runDouyinSync(() => undefined, control);

    expect(mocks.setBackfill.mock.calls).toEqual([
      [{ resumeCursor: '1789000000000000', backfillDone: false }],
      [{ resumeCursor: null, backfillDone: true }],
    ]);
  });

  it('dispatches every persisted page to the embed / tag lanes by platformItemId, page by page (D-b)', async () => {
    let enqueuedAfterFirstPage = 0;
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      opts.onPagePersisted?.(['7300000000000000001', '7300000000000000002']);
      enqueuedAfterFirstPage = mocks.enqueue.mock.calls.length;
      opts.onPagePersisted?.(['7300000000000000003']);
      return {
        fetched: 3,
        inserted: 3,
        folders: 0,
        newItemIds: ['7300000000000000001', '7300000000000000002', '7300000000000000003'],
      };
    });

    await runDouyinSync(() => undefined, control);

    // Dispatched as each page lands, not at the end of the run.
    expect(enqueuedAfterFirstPage).toBe(2);
    expect(mocks.enqueue.mock.calls.map((call) => call[0])).toEqual([
      { jobPlatform: 'douyin', itemPlatform: 'douyin', itemId: '7300000000000000001' },
      { jobPlatform: 'douyin', itemPlatform: 'douyin', itemId: '7300000000000000002' },
      { jobPlatform: 'douyin', itemPlatform: 'douyin', itemId: '7300000000000000003' },
    ]);
    // ...so the funnel gets no batch to dispatch a second time.
    expect(outcome).toEqual({ fetched: 3, inserted: 3, newItemIds: [] });
  });

  it('maps page progress (initial zero seed + per-page updates)', async () => {
    const progress: DouyinSyncProgress[] = [];
    mocks.syncDouyinCollections.mockImplementation(async (_t: unknown, opts: SyncDouyinOptions) => {
      opts.onProgress?.(20, 1);
      opts.onProgress?.(39, 2);
      return { fetched: 39, inserted: 0, folders: 0, newItemIds: [] };
    });

    await runDouyinSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { fetchedCount: 0, page: 0 },
      { fetchedCount: 20, page: 1 },
      { fetchedCount: 39, page: 2 },
    ]);
  });

  it('daily readiness asks the same tab resolver, and a logged-out tab fails silently', async () => {
    mocks.findDouyinTab.mockResolvedValue(null);
    await expect(douyinAutoSyncPolicy.probeReady()).resolves.toBe(false);
    mocks.findDouyinTab.mockResolvedValue(11);
    await expect(douyinAutoSyncPolicy.probeReady()).resolves.toBe(true);

    expect(douyinAutoSyncPolicy.isSilentError?.(new mocks.DouyinAuthError('out', 'missing'))).toBe(true);
    expect(douyinAutoSyncPolicy.isSilentError?.(new Error('boom'))).toBe(false);
  });
});
