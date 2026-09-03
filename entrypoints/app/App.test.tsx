// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  sendBackgroundMessage: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  Outlet: () => <main data-testid="outlet" />,
}));

vi.mock('@/lib/background/client', () => ({
  sendBackgroundMessage: mocks.sendBackgroundMessage,
}));

vi.mock('./collection-platform-auto-sync', () => ({
  AUTO_SYNC_PLATFORMS: [],
}));

vi.mock('./hooks/use-daily-auto-sync', () => ({
  useDailyAutoSync: vi.fn(),
}));

vi.mock('./theme/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The appearance drawer needs the SettingsProvider main.tsx mounts; this file
// tests the router root's own wiring, so it stands in for it (and doubles as
// the assertion that the drawer is mounted here at all — docs/25 Step 4).
vi.mock('./components/settings', () => ({
  SettingsDrawer: () => <div data-testid="settings-drawer" />,
}));

// Same reasoning for the toast region (docs/25 Step 5): the real one reaches
// the i18n store, and mounting it here is the wiring under test.
vi.mock('./components/snackbar', () => ({
  Snackbar: () => <div data-testid="snackbar" />,
}));

import App from './App';

describe('App Agent Bridge startup', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.sendBackgroundMessage.mockReset().mockResolvedValue(undefined);
    mocks.consoleError.mockReset();
    vi.spyOn(console, 'error').mockImplementation(mocks.consoleError);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('asks Background to connect immediately when app.html opens', async () => {
    await act(async () => root.render(<App />));

    expect(mocks.sendBackgroundMessage).toHaveBeenCalledOnce();
    expect(mocks.sendBackgroundMessage).toHaveBeenCalledWith({
      type: 'AGENT_BRIDGE_CONNECT_NOW',
    });
    expect(container.querySelector('[data-testid="outlet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-drawer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="snackbar"]')).not.toBeNull();
  });

  it('keeps the app mounted when the immediate request fails', async () => {
    const error = new Error('background unavailable');
    mocks.sendBackgroundMessage.mockRejectedValue(error);

    await act(async () => root.render(<App />));

    expect(mocks.consoleError).toHaveBeenCalledWith(
      '[Agent Bridge] Immediate connection request failed',
      error,
    );
    expect(container.querySelector('[data-testid="outlet"]')).not.toBeNull();
  });
});
