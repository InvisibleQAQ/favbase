import { afterEach, describe, expect, it, vi } from 'vitest';

import { initJobsBadgeJanitor, sweepJobsBadge } from './jobs-badge';

interface FakeTab {
  id?: number;
}

function stubBrowser(appTabs: FakeTab[] = []) {
  const action = {
    setBadgeText: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined),
  };
  const onRemoved = { addListener: vi.fn() };
  const tabs = { query: vi.fn(async () => appTabs), onRemoved };

  vi.stubGlobal('browser', {
    runtime: { getURL: (path: string) => `chrome-extension://fake${path}` },
    tabs,
    action,
  });

  return { action, tabs, onRemoved };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sweepJobsBadge', () => {
  it('clears badge and title when no app tab remains', async () => {
    const { action, tabs } = stubBrowser([]);

    await sweepJobsBadge();

    expect(tabs.query).toHaveBeenCalledWith({
      url: 'chrome-extension://fake/app.html',
    });
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(action.setTitle).toHaveBeenCalledWith({ title: '' });
  });

  it('leaves the badge alone while an app tab is open', async () => {
    const { action } = stubBrowser([{ id: 4 }]);

    await sweepJobsBadge();

    expect(action.setBadgeText).not.toHaveBeenCalled();
    expect(action.setTitle).not.toHaveBeenCalled();
  });

  // During tabs.onRemoved the closing tab can still show up in tabs.query;
  // counting it would skip the wipe exactly when it matters.
  it('does not count the just-closed tab', async () => {
    const { action } = stubBrowser([{ id: 7 }]);

    await sweepJobsBadge(7);

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('still sees other app tabs when one of several closes', async () => {
    const { action } = stubBrowser([{ id: 7 }, { id: 9 }]);

    await sweepJobsBadge(7);

    expect(action.setBadgeText).not.toHaveBeenCalled();
  });
});

describe('initJobsBadgeJanitor', () => {
  it('sweeps once at SW start (page may have closed while the SW slept)', async () => {
    const { action } = stubBrowser([]);

    initJobsBadgeJanitor();

    await vi.waitFor(() => {
      expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  it('sweeps with the closed tab id on every tab removal', async () => {
    const { action, onRemoved } = stubBrowser([{ id: 5 }]);

    initJobsBadgeJanitor();
    const listener = onRemoved.addListener.mock.calls[0][0] as (tabId: number) => void;
    listener(5);

    await vi.waitFor(() => {
      expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  it('survives a failing sweep (no unhandled rejection)', async () => {
    const { tabs } = stubBrowser([]);
    tabs.query.mockRejectedValue(new Error('tabs api down'));

    initJobsBadgeJanitor();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
