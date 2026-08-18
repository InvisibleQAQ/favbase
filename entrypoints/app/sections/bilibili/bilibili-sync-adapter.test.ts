import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BiliFavFolder } from '@/lib/bilibili/types';
import type { CooperativeCheckpoint } from '@/lib/collections';

const mocks = vi.hoisted(() => ({
  fetchAndSyncFolders: vi.fn(),
  runBiliStreamingSync: vi.fn(),
  startCollectionProcessingJobs: vi.fn(),
}));

vi.mock('@/lib/bilibili/bili-sync-service', () => ({
  fetchAndSyncFolders: mocks.fetchAndSyncFolders,
}));
vi.mock('./auto-transcribe-runtime', () => ({
  runBiliStreamingSync: mocks.runBiliStreamingSync,
}));
// Real module pulls the embedding/tagging barrels (chrome.storage at load).
vi.mock('../../hooks/collection-processing-jobs', () => ({
  startCollectionProcessingJobs: mocks.startCollectionProcessingJobs,
}));

import { runBilibiliSync } from './bilibili-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
const noProgress = (): void => undefined;

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
    mocks.fetchAndSyncFolders.mockReset().mockResolvedValue([folder(10), folder(20)]);
    mocks.runBiliStreamingSync.mockReset().mockResolvedValue({ fetchedCount: 0 });
    mocks.startCollectionProcessingJobs.mockReset();
  });

  it('runs the natural folder order through the streaming runtime by default', async () => {
    await runBilibiliSync(noProgress, control);

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
      return { fetchedCount: 0 };
    });

    await runBilibiliSync(noProgress, control, {
      onFolders: (folders) => seen.push(folders.map((f) => f.id)),
    });

    expect(seen).toEqual([[10, 20]]);
  });

  it('dispatches the backlog embed lane (empty ids) after the streaming run', async () => {
    await runBilibiliSync(noProgress, control);

    expect(mocks.startCollectionProcessingJobs).toHaveBeenCalledWith({
      jobPlatform: 'bilibili',
      itemPlatform: 'bilibili',
      itemIds: [],
    });
  });

  it('starts no streaming and dispatches nothing when the folder sync fails', async () => {
    mocks.fetchAndSyncFolders.mockRejectedValue(new Error('not logged in'));

    await expect(runBilibiliSync(noProgress, control)).rejects.toThrow('not logged in');
    expect(mocks.runBiliStreamingSync).not.toHaveBeenCalled();
    expect(mocks.startCollectionProcessingJobs).not.toHaveBeenCalled();
  });
});
