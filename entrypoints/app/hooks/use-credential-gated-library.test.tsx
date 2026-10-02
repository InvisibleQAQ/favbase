// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';
import type { UserSettings } from '@/lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  settings: { settings: {} as Partial<UserSettings>, loading: false },
}));

vi.mock('@/lib/database', () => ({
  initDbProxy: vi.fn(async () => ({})),
}));

// The real hook loads `@/lib/storage` (chrome.storage at import) and the
// embedding config; the gate only needs `settings` + `loading`.
vi.mock('@/lib/hooks/useSettings', () => ({
  useSettings: () => mocks.settings,
}));

import { useCredentialGatedLibrary } from './use-credential-gated-library';

type Gated = ReturnType<typeof useCredentialGatedLibrary<string, never, void>>;

const queryFn = vi.fn(async () => ({ rows: [] as string[], total: 0 }));
const facetsFn = vi.fn(async (): Promise<never[]> => []);
const lastSyncedFn = vi.fn(async (): Promise<Date | null> => null);
const syncFn = vi.fn(
  async (_onProgress: (progress: void) => void, _control: CooperativeCheckpoint) => {},
);
/** The probe's resolver: a token, or `null` when none is stored. */
const credentials = (settings: UserSettings) => settings.githubToken || null;

function setSettings(settings: Partial<UserSettings>, loading = false): void {
  mocks.settings = { settings, loading };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useCredentialGatedLibrary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Gated;
  let run = 0;
  let jobPlatform: string;

  function Probe() {
    latest = useCredentialGatedLibrary<string, never, void>(credentials, {
      queryFn,
      facetsFn,
      lastSyncedFn,
      syncFn,
      jobPlatform,
    });
    return null;
  }

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<Probe />);
    });
    await flush();
  }

  beforeEach(() => {
    queryFn.mockClear();
    facetsFn.mockClear();
    lastSyncedFn.mockClear();
    syncFn.mockClear();
    setSettings({});
    // Distinct job namespace per test — the background-jobs store is a module singleton.
    run += 1;
    jobPlatform = `gated-test-${run}`;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('unconfigured: sync() is a silent no-op — no job, no syncing flip', async () => {
    await render();
    expect(latest.configured).toBe(false);

    await act(async () => {
      await latest.sync();
    });
    await flush();

    expect(syncFn).not.toHaveBeenCalled();
    expect(latest.syncing).toBe(false);
    expect(latest.syncJob).toBeNull();
  });

  it('configured: sync() runs the platform sync once', async () => {
    setSettings({ githubToken: 'tok' });
    await render();
    expect(latest.configured).toBe(true);

    await act(async () => {
      await latest.sync();
    });
    await flush();

    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it('passes settingsLoading through', async () => {
    setSettings({}, true);
    await render();
    expect(latest.settingsLoading).toBe(true);

    setSettings({}, false);
    await render();
    expect(latest.settingsLoading).toBe(false);
  });

  it('follows the settings: configured flips when the credential arrives', async () => {
    await render();
    expect(latest.configured).toBe(false);

    setSettings({ githubToken: 'tok' });
    await render();
    expect(latest.configured).toBe(true);

    await act(async () => {
      await latest.sync();
    });
    await flush();
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});
