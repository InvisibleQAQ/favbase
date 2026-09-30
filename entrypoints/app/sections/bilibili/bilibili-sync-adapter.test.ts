import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder } from '@/lib/bilibili/types';
import type { CooperativeCheckpoint } from '@/lib/collections';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  checkAuth: vi.fn(),
  fetchAndSyncFolders: vi.fn(),
  runBiliStreamingSync: vi.fn(),
  runPlatformSync: vi.fn(),
  BiliAuthError: class BiliAuthError extends Error {},
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  checkAuth: mocks.checkAuth,
  fetchAndSyncFolders: mocks.fetchAndSyncFolders,
}));
vi.mock('./auto-transcribe-runtime', () => ({
  runBiliStreamingSync: mocks.runBiliStreamingSync,
}));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { runBilibiliSync } from './bilibili-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const noProgress = (): void => undefined;
let outcome: PlatformSyncOutcome | undefined;

function folder(id: number): BiliFavFolder {
  return {
    id,
    fid: id,
    mid: 1,
    title: `folder ${id}`,
    media_count: 20,
    cover: '',
    intro: '',
    ctime: 0,
    mtime: 0,
    attr: 0,
    fav_state: 0,
  };
}

describe('bilibili Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.checkAuth.mockReset().mockResolvedValue({ SESSDATA: 's', mid: 1 });
    mocks.fetchAndSyncFolders.mockReset().mockResolvedValue([folder(10), folder(20)]);
    mocks.runBiliStreamingSync
      .mockReset()
      .mockResolvedValue({ fetchedCount: 0, syncedCount: 0, insertedCount: 0 });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('runs the natural folder order through the streaming runtime inside the funnel', async () => {
    await runBilibiliSync(noProgress, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('bilibili', control, expect.any(Function));
    expect(mocks.fetchAndSyncFolders).toHaveBeenCalledWith(control);
    expect(mocks.runBiliStreamingSync).toHaveBeenCalledWith(
      [folder(10), folder(20)],
      noProgress,
      control,
    );
  });

  it('moves the preferred (route-selected) folder to the front', async () => {
    await runBilibiliSync(noProgress, control, { preferFolderId: 20 });

    expect(mocks.runBiliStreamingSync).toHaveBeenCalledWith(
      [folder(20), folder(10)],
      noProgress,
      control,
    );
  });

  it('keeps the natural order when the preferred folder no longer exists', async () => {
    await runBilibiliSync(noProgress, control, { preferFolderId: 99 });

    expect(mocks.runBiliStreamingSync).toHaveBeenCalledWith(
      [folder(10), folder(20)],
      noProgress,
      control,
    );
  });

  it('reports the folder list to the trigger before streaming starts', async () => {
    const seen: number[][] = [];
    mocks.runBiliStreamingSync.mockImplementation(async () => {
      expect(seen).toHaveLength(1);
      return { fetchedCount: 0, syncedCount: 0, insertedCount: 0 };
    });

    await runBilibiliSync(noProgress, control, {
      onFolders: (folders) => seen.push(folders.map((f) => f.id)),
    });

    expect(seen).toEqual([[10, 20]]);
  });

  it('reports videos paged and inserted; no batch tag ids (transcription processes per item)', async () => {
    mocks.runBiliStreamingSync.mockResolvedValue({
      fetchedCount: 40,
      syncedCount: 38,
      insertedCount: 5,
    });

    await runBilibiliSync(noProgress, control);

    expect(outcome).toEqual({ fetched: 40, inserted: 5, newItemIds: [] });
  });

  it('rethrows the logged-out error BEFORE the funnel (no attempt, no request)', async () => {
    const loggedOut = new mocks.BiliAuthError('Not logged in');
    mocks.checkAuth.mockRejectedValue(loggedOut);

    await expect(runBilibiliSync(noProgress, control)).rejects.toBe(loggedOut);
    expect(mocks.runPlatformSync).not.toHaveBeenCalled();
    expect(mocks.fetchAndSyncFolders).not.toHaveBeenCalled();
  });

  it('starts no streaming when the folder sync fails inside the funnel', async () => {
    mocks.fetchAndSyncFolders.mockRejectedValue(new Error('HTTP 412'));

    await expect(runBilibiliSync(noProgress, control)).rejects.toThrow('HTTP 412');
    expect(mocks.runBiliStreamingSync).not.toHaveBeenCalled();
  });
});
