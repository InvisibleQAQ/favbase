// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({
  pinned: true,
  setPinned: vi.fn((value: boolean) => Promise.resolve(void value)),
}));

vi.mock('@/lib/storage', () => ({
  sidebarPinnedStorage: {
    getValue: () => Promise.resolve(storageState.pinned),
    setValue: storageState.setPinned,
    watch: () => () => undefined,
  },
  localeStorage: {
    getValue: () => Promise.resolve('en' as const),
    setValue: () => Promise.resolve(),
    watch: () => () => undefined,
  },
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    preference: 'auto',
    setLocale: () => undefined,
  }),
}));

const mediaState = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@mui/material/useMediaQuery', () => ({ default: () => mediaState.isDesktop }));

// Both hooks reach the module-level background-jobs store and chrome.action;
// the shell contract under test is composition, not job tracking.
vi.mock('../../hooks/use-jobs-badge', () => ({ useJobsBadge: () => undefined }));
vi.mock('./background-jobs-indicator', () => ({ BackgroundJobsIndicator: () => null }));

import { ThemeProvider } from '../../theme/theme-provider';
import type { NavItem } from '../nav-config';
import { DashboardLayout } from './layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAVIGATION: NavItem[] = [
  { title: 'nav.dashboard', path: '/', icon: <span /> },
  { title: 'nav.settings', path: '/settings', icon: <span /> },
];

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function renderShell(root: Root) {
  act(() => {
    root.render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <DashboardLayout navigation={NAVIGATION}>
            <LocationProbe />
          </DashboardLayout>
        </MemoryRouter>
      </ThemeProvider>,
    );
  });
}

describe('DashboardLayout shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    storageState.pinned = true;
    storageState.setPinned.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('labels the desktop sidebar toggle and persists pin/unpin', async () => {
    mediaState.isDesktop = true;
    renderShell(root);
    await act(async () => {
      await Promise.resolve();
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="header.sidebarToggleAria"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('button[aria-label="header.menuAria"]')).toBeNull();

    act(() => toggle?.click());

    expect(storageState.setPinned).toHaveBeenCalledWith(false);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the mobile drawer on navigation and returns focus to the menu button', async () => {
    vi.useFakeTimers();
    mediaState.isDesktop = false;
    renderShell(root);

    const menuButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="header.menuAria"]',
    );
    expect(menuButton).not.toBeNull();
    expect(container.querySelector('button[aria-label="header.sidebarToggleAria"]')).toBeNull();

    await act(async () => {
      menuButton?.focus();
      menuButton?.click();
      await vi.advanceTimersByTimeAsync(1000);
    });

    const drawerLink = document.body.querySelector<HTMLAnchorElement>(
      '.MuiDrawer-root a[href="/settings"]',
    );
    expect(drawerLink).not.toBeNull();

    await act(async () => {
      drawerLink?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await vi.advanceTimersByTimeAsync(1000);
    });
    // Route change → NavMobile effect → onClose → Slide exit: the exit timer is
    // scheduled after the first flush, so advance once more to let it fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
    expect(document.body.querySelector('.MuiDrawer-root')).toBeNull();
    expect(container.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(menuButton);
  });
});
