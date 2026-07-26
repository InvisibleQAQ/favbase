import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stub of WXT's storage.defineItem — the real one needs a browser
// extension context (chrome.storage), which vitest lacks. Mirrors the stub in
// lib/storage/x-last-sync.test.ts.
vi.mock('wxt/utils/storage', () => {
  const store = new Map<string, unknown>();
  return {
    storage: {
      defineItem<T>(key: string, opts?: { fallback?: T }) {
        return {
          async getValue(): Promise<T> {
            return (store.has(key) ? store.get(key) : opts?.fallback) as T;
          },
          async setValue(value: T): Promise<void> {
            store.set(key, value);
          },
          async removeValue(): Promise<void> {
            store.delete(key);
          },
        };
      },
    },
  };
});

import { onboardingStorage } from '@/lib/storage';

import { handleOpenAppPage, openWelcomePage } from './app-handlers';

interface FakeTab {
  id?: number;
  windowId?: number;
}

function stubBrowser(existingTabs: FakeTab[] = []) {
  const tabs = {
    query: vi.fn(async () => existingTabs),
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
  };
  const windows = { update: vi.fn(async () => undefined) };

  vi.stubGlobal('browser', {
    runtime: { getURL: (path: string) => `chrome-extension://fake${path}` },
    tabs,
    windows,
  });

  return { tabs, windows };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await onboardingStorage.removeValue();
});

describe('openWelcomePage', () => {
  it('opens welcome.html on a profile that has never onboarded', async () => {
    const { tabs } = stubBrowser();

    await openWelcomePage();

    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://fake/welcome.html',
    });
  });

  // The gate that matters: reloading an unpacked extension also reports
  // onInstalled reason 'install', so without this check the tab would reappear
  // on every dev reload.
  it('is a no-op once the flow was completed or skipped', async () => {
    await onboardingStorage.setValue({ completedAt: 1, platforms: [] });
    const { tabs } = stubBrowser();

    await openWelcomePage();

    expect(tabs.query).not.toHaveBeenCalled();
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('treats a skip (no platforms picked) as completed', async () => {
    await onboardingStorage.setValue({ completedAt: 2, platforms: [] });
    const { tabs } = stubBrowser();

    await openWelcomePage();

    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('focuses the existing welcome tab and raises its window', async () => {
    const { tabs, windows } = stubBrowser([{ id: 7, windowId: 3 }]);

    await openWelcomePage();

    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(windows.update).toHaveBeenCalledWith(3, { focused: true });
  });
});

describe('handleOpenAppPage', () => {
  it('navigates an existing tab when a hash is requested', async () => {
    const { tabs, windows } = stubBrowser([{ id: 4, windowId: 1 }]);

    await handleOpenAppPage({ type: 'OPEN_APP_PAGE', hash: '#/settings' });

    expect(tabs.update).toHaveBeenCalledWith(4, {
      active: true,
      url: 'chrome-extension://fake/app.html#/settings',
    });
    expect(windows.update).toHaveBeenCalledWith(1, { focused: true });
  });

  // A bare focus must not throw the user off whatever route they were on.
  it('does not touch the url on a bare focus', async () => {
    const { tabs } = stubBrowser([{ id: 4, windowId: 1 }]);

    await handleOpenAppPage({ type: 'OPEN_APP_PAGE' });

    expect(tabs.update).toHaveBeenCalledWith(4, { active: true });
  });

  it('creates the tab already pointed at the hash when none is open', async () => {
    const { tabs } = stubBrowser();

    await handleOpenAppPage({ type: 'OPEN_APP_PAGE', hash: '#/chat' });

    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://fake/app.html#/chat',
    });
  });

  it('creates a bare tab when no hash was requested', async () => {
    const { tabs } = stubBrowser();

    await handleOpenAppPage({ type: 'OPEN_APP_PAGE' });

    expect(tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://fake/app.html' });
  });

  // A match with no id cannot be updated (some detached tabs report none),
  // so it must fall through to create rather than silently do nothing.
  it('creates a tab when the match has no id', async () => {
    const { tabs } = stubBrowser([{ windowId: 1 }]);

    await handleOpenAppPage({ type: 'OPEN_APP_PAGE', hash: '#/settings' });

    expect(tabs.update).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://fake/app.html#/settings',
    });
  });
});
