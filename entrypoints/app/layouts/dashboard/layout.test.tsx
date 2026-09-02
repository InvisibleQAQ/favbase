// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({
  pinned: true,
  setPinned: vi.fn((value: boolean) => Promise.resolve(void value)),
}));

const THEME_SETTINGS = vi.hoisted(() => ({
  primaryColor: 'default' as const,
  contrast: 'default' as const,
  compactLayout: false,
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
  // The header's SettingsButton reads the appearance context (docs/25 Step 4);
  // the shell contract under test is composition, so the store is a stub.
  DEFAULT_THEME_SETTINGS: THEME_SETTINGS,
  isSameThemeSettings: (a: typeof THEME_SETTINGS, b: typeof THEME_SETTINGS) =>
    a.primaryColor === b.primaryColor &&
    a.contrast === b.contrast &&
    a.compactLayout === b.compactLayout,
  setThemeSettings: () => Promise.resolve(),
  watchThemeSettings: () => () => undefined,
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
import { layoutClasses } from '../core/classes';
import { SettingsProvider } from '../../components/settings';
import type { NavGroup } from '../nav-config';
import { DashboardLayout } from './layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAVIGATION: NavGroup[] = [
  {
    subheader: 'nav.groupGeneral',
    items: [
      { title: 'nav.dashboard', path: '/', icon: <span /> },
      { title: 'nav.settings', path: '/settings', icon: <span /> },
    ],
  },
];

/** Adds a branch row so the rail renders a disclosure button inside `nav`. */
const NAVIGATION_WITH_BRANCH: NavGroup[] = [
  {
    subheader: 'nav.groupCollections',
    items: [
      {
        title: 'nav.collections',
        path: '/collections',
        icon: <span />,
        children: [{ title: 'nav.bilibiliFavorites', path: '/collections/bilibili' }],
      },
    ],
  },
  ...NAVIGATION,
];

function header(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.${layoutClasses.header}`);
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function renderShell(root: Root, navigation: NavGroup[] = NAVIGATION) {
  act(() => {
    root.render(
      <SettingsProvider initialState={THEME_SETTINGS}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>
            <DashboardLayout navigation={navigation}>
              <LocationProbe />
            </DashboardLayout>
          </MemoryRouter>
        </ThemeProvider>
      </SettingsProvider>,
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

  it('collapses the rail from the nav toggle and persists pin/unpin', async () => {
    mediaState.isDesktop = true;
    renderShell(root);
    await act(async () => {
      await Promise.resolve();
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="nav.collapseAria"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    // docs/25 Step 4: the rail owns this control; the header no longer has one.
    expect(header(container)?.contains(toggle!)).toBe(false);
    expect(container.querySelector('button[aria-label="header.menuAria"]')).toBeNull();

    act(() => toggle?.click());

    expect(storageState.setPinned).toHaveBeenCalledWith(false);
    const collapsed = container.querySelector<HTMLButtonElement>(
      'button[aria-label="nav.expandAria"]',
    );
    expect(collapsed).not.toBeNull();
    expect(collapsed?.getAttribute('aria-expanded')).toBe('false');
  });

  // Regression for docs/25 Step 4: moving the toggle out of the Header silently
  // killed `header button[aria-expanded]` in `docs/ui-baseline/app-runtime-check.mjs`,
  // whose `?.click()` then no-opped and let the 300px -> 88px assertion blame the
  // layout. The script now selects
  // `button[aria-expanded]:not(header button):not(nav button)` and asserts one
  // hit; happy-dom cannot parse a `:not()` with a descendant combinator, so the
  // same contract is expressed here by filtering. Keep both in step.
  it('exposes exactly one aria-expanded control outside the header and the nav', async () => {
    mediaState.isDesktop = true;
    renderShell(root, NAVIGATION_WITH_BRANCH);
    await act(async () => {
      await Promise.resolve();
    });

    const expandable = [...container.querySelectorAll<HTMLElement>('button[aria-expanded]')];
    // The fixture's branch row must contribute a disclosure, or the `nav`
    // exclusion below would pass for the wrong reason.
    expect(expandable.some((button) => button.closest('nav'))).toBe(true);

    const outside = expandable.filter(
      (button) => !button.closest('header') && !button.closest('nav'),
    );
    expect(outside).toHaveLength(1);
    expect(outside[0].getAttribute('aria-label')).toBe('nav.collapseAria');
  });

  it('mounts the four header controls in order', async () => {
    mediaState.isDesktop = true;
    renderShell(root);
    await act(async () => {
      await Promise.resolve();
    });

    // BackgroundJobsIndicator is stubbed out above; the remaining three are the
    // shell's own (docs/25 Step 4 header contract).
    const labels = Array.from(container.querySelectorAll(`.${'MuiIconButton-root'}`))
      .map((node) => node.getAttribute('aria-label'))
      .filter((label): label is string => !!label && label.startsWith('header.'));

    expect(labels).toEqual(['header.languageAria', 'header.settingsAria', 'header.githubAria']);
  });

  it('closes the mobile drawer on navigation and returns focus to the menu button', async () => {
    vi.useFakeTimers();
    mediaState.isDesktop = false;
    renderShell(root);

    const menuButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="header.menuAria"]',
    );
    expect(menuButton).not.toBeNull();
    // The rail and its toggle share one `layoutQuery` CSS rule, so on mobile the
    // header's only nav control is the hamburger.
    expect(header(container)?.querySelector('button[aria-label^="nav."]')).toBeNull();

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
