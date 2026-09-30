import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  syncFavorites: vi.fn(),
  runPlatformSync: vi.fn(),
}));

vi.mock('@/lib/zhihu/zhihu-sync-service', () => ({
  syncFavorites: mocks.syncFavorites,
  ZhihuAuthError: class ZhihuAuthError extends Error {},
}));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { runZhihuFavoritesSync, type ZhihuSyncProgress } from './zhihu-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
let outcome: PlatformSyncOutcome | undefined;

describe('zhihu Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.syncFavorites.mockReset().mockResolvedValue({ total: 0, inserted: 0, newItemIds: [] });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('runs the whole domain sync inside the funnel (cookie auth, nothing to check first)', async () => {
    await runZhihuFavoritesSync(() => undefined, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('zhihu', control, expect.any(Function));
    expect(mocks.syncFavorites).toHaveBeenCalledWith(expect.any(Function), control);
  });

  it('maps collection-cursor progress (initial zero seed + per-page updates)', async () => {
    const progress: ZhihuSyncProgress[] = [];
    mocks.syncFavorites.mockImplementation(
      async (onPage: (fetchedCount: number, current: number, total: number) => void) => {
        onPage(12, 1, 3);
        onPage(20, 2, 3);
        return { total: 20, inserted: 0, newItemIds: [] };
      },
    );

    await runZhihuFavoritesSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { fetchedCount: 0, current: 0, total: 0 },
      { fetchedCount: 12, current: 1, total: 3 },
      { fetchedCount: 20, current: 2, total: 3 },
    ]);
  });

  it('reports entries read, items inserted and the persisted ids to the funnel', async () => {
    mocks.syncFavorites.mockResolvedValue({ total: 12, inserted: 1, newItemIds: ['z1'] });

    await runZhihuFavoritesSync(() => undefined, control);

    expect(outcome).toEqual({ fetched: 12, inserted: 1, newItemIds: ['z1'] });
  });
});
