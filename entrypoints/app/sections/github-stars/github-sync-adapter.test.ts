import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';
import type { UserSettings } from '@/lib/storage';

import type { PlatformSyncOutcome } from '../../hooks/platform-sync';

const mocks = vi.hoisted(() => ({
  syncStars: vi.fn(),
  getSettings: vi.fn(),
  runPlatformSync: vi.fn(),
}));

vi.mock('@/lib/github/github-sync-service', () => ({ syncStars: mocks.syncStars }));
// Real module runs storage.defineItem (chrome.storage) at load.
vi.mock('@/lib/storage', () => ({ settingsStorage: { getValue: mocks.getSettings } }));
// The funnel (record + dispatch) has its own tests; here it is a passthrough
// that runs the adapter's sync closure and keeps what it reported.
vi.mock('../../hooks/platform-sync', () => ({ runPlatformSync: mocks.runPlatformSync }));

import { githubCredentials, runGithubStarsSync, type SyncProgress } from './github-sync-adapter';

const control: CooperativeCheckpoint = { checkpoint: async () => undefined };
let outcome: PlatformSyncOutcome | undefined;

describe('github Sync Adapter (shared by manual page + daily auto-sync)', () => {
  beforeEach(() => {
    outcome = undefined;
    mocks.getSettings.mockReset().mockResolvedValue({ githubToken: 'tok' });
    mocks.syncStars.mockReset().mockResolvedValue({ total: 0, inserted: 0, newItemIds: [] });
    mocks.runPlatformSync
      .mockReset()
      .mockImplementation(async (_platform, _control, sync: () => Promise<PlatformSyncOutcome>) => {
        outcome = await sync();
      });
  });

  it('is a silent no-op without a token (never reaches the funnel, records nothing)', async () => {
    mocks.getSettings.mockResolvedValue({});

    await runGithubStarsSync(() => undefined, control);

    expect(mocks.runPlatformSync).not.toHaveBeenCalled();
    expect(mocks.syncStars).not.toHaveBeenCalled();
  });

  it('runs the domain sync inside the funnel with the token and the checkpoint', async () => {
    await runGithubStarsSync(() => undefined, control);

    expect(mocks.runPlatformSync).toHaveBeenCalledWith('github', control, expect.any(Function));
    expect(mocks.syncStars).toHaveBeenCalledWith(
      'tok',
      expect.any(Function),
      expect.any(Function),
      control,
    );
  });

  it('maps stars + readme progress; readme keeps the final fetched count', async () => {
    const progress: SyncProgress[] = [];
    mocks.syncStars.mockImplementation(
      async (
        _token: string,
        onStars: (page: number, totalPages: number, fetchedCount: number) => void,
        onReadme: (done: number, total: number) => void,
      ) => {
        onStars(1, 2, 30);
        onStars(2, 2, 55);
        onReadme(1, 3);
        return { total: 55, inserted: 0, newItemIds: [] };
      },
    );

    await runGithubStarsSync((p) => progress.push(p), control);

    expect(progress).toEqual([
      { phase: 'stars', page: 0, totalPages: 0, fetchedCount: 0, estimatedTotal: 0 },
      { phase: 'stars', page: 1, totalPages: 2, fetchedCount: 30, estimatedTotal: 60 },
      { phase: 'stars', page: 2, totalPages: 2, fetchedCount: 55, estimatedTotal: 55 },
      { phase: 'readme', done: 1, total: 3, fetchedCount: 55 },
    ]);
  });

  it('reports stars read, repos inserted and the persisted ids to the funnel', async () => {
    mocks.syncStars.mockResolvedValue({ total: 55, inserted: 2, newItemIds: ['a', 'b'] });

    await runGithubStarsSync(() => undefined, control);

    expect(outcome).toEqual({ fetched: 55, inserted: 2, newItemIds: ['a', 'b'] });
  });
});

describe('githubCredentials (run gate, daily probe and page gate share it)', () => {
  it('returns the stored token', () => {
    expect(githubCredentials({ githubToken: 'tok' } as UserSettings)).toBe('tok');
  });

  it('is null for a missing or empty token', () => {
    expect(githubCredentials({} as UserSettings)).toBeNull();
    expect(githubCredentials({ githubToken: '' } as UserSettings)).toBeNull();
  });
});
