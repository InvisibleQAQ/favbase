import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  getXAuth: vi.fn(),
  syncBookmarks: vi.fn(),
  runPlatformSync: vi.fn(),
  XAuthError: class XAuthError extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/x/x-auth', () => ({ getXAuth: mocks.getXAuth }));
vi.mock('@/lib/x/x-sync-service', () => ({
  syncBookmarks: mocks.syncBookmarks,
  XAuthError: mocks.XAuthError,
}));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { runXBookmarksSync, type XSyncProgress } from './x-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const AUTH = { cookie: 'c', csrf: 't', bearer: 'b' };
let outcome: PlatformSyncOutcome | undefined;

describe('x Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.getXAuth.mockReset().mockResolvedValue(AUTH);
    mocks.syncBookmarks.mockReset().mockResolvedValue({ total: 0, newItemIds: [], inserted: 0 });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('runs the domain sync inside the funnel with the captured session and the checkpoint', async () => {
    await runXBookmarksSync(() => undefined, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('x', control, expect.any(Function));
    expect(mocks.syncBookmarks).toHaveBeenCalledWith(AUTH, expect.any(Function), control);
  });

  it('throws the missing-session auth error BEFORE the funnel when no session was captured', async () => {
    mocks.getXAuth.mockResolvedValue(null);

    const run = runXBookmarksSync(() => undefined, control);

    await expect(run).rejects.toBeInstanceOf(mocks.XAuthError);
    await expect(run).rejects.toMatchObject({ reason: 'missing' });
    // Not an attempt: nothing recorded, the platform never contacted.
    expect(mocks.runPlatformSync).not.toHaveBeenCalled();
    expect(mocks.syncBookmarks).not.toHaveBeenCalled();
  });

  it('maps cursor progress (initial zero seed + per-page updates)', async () => {
    const progress: XSyncProgress[] = [];
    mocks.syncBookmarks.mockImplementation(
      async (_auth: unknown, onPage: (fetchedCount: number, page: number) => void) => {
        onPage(20, 1);
        onPage(37, 2);
        return { total: 37, newItemIds: [], inserted: 0 };
      },
    );

    await runXBookmarksSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { fetchedCount: 0, page: 0 },
      { fetchedCount: 20, page: 1 },
      { fetchedCount: 37, page: 2 },
    ]);
  });

  it('reports tweets read, items inserted ("N new") and the persisted ids to the funnel', async () => {
    mocks.syncBookmarks.mockResolvedValue({ total: 37, newItemIds: ['t1', 't2'], inserted: 5 });

    await runXBookmarksSync(() => undefined, control);

    expect(outcome).toEqual({ fetched: 37, inserted: 5, newItemIds: ['t1', 't2'] });
  });
});
