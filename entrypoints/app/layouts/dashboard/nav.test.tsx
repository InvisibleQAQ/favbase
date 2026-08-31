// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: () => Promise.resolve('en' as const),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

import { ThemeProvider } from '../../theme/theme-provider';
import { themeConfig } from '../../theme/theme-config';
import type { NavItem } from '../nav-config';
import { NavDesktop } from './nav';

const COLLECTIONS_NAV: NavItem[] = [
  {
    title: 'nav.collections',
    path: '/collections',
    icon: <span />,
    children: [
      {
        title: 'nav.collections',
        path: '/collections/bilibili',
        platform: 'bilibili',
        icon: <span data-testid="platform-icon" />,
      },
      {
        title: 'nav.requestPlatform',
        path: 'https://example.com/request-platform',
        external: true,
        icon: <span />,
      },
    ],
  },
];

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
  });
}

describe('Collections sidebar navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/settings']}>
            <NavDesktop data={COLLECTIONS_NAV} layoutQuery="lg" pinned />
            <LocationProbe />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('navigates to the aggregate page from the Collections parent link', () => {
    const collectionsLink = container.querySelector('a[href="/collections"]');

    expect(collectionsLink).not.toBeNull();
    click(collectionsLink!);

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/collections',
    );
  });

  it('renders the project logo in the sidebar brand', () => {
    const logo = container.querySelector('img[src="/icon/128.png"]');

    expect(logo).not.toBeNull();
    expect(logo?.getAttribute('alt')).toBe('');
  });

  it('toggles the submenu from the chevron without navigating', () => {
    const toggle = container.querySelector('button[aria-expanded="false"]');

    expect(toggle).not.toBeNull();
    click(toggle!);

    const expandedToggle = container.querySelector('button[aria-expanded="true"]');
    const submenuId = expandedToggle?.getAttribute('aria-controls');

    expect(expandedToggle).not.toBeNull();
    expect(submenuId).toBeTruthy();
    expect(document.getElementById(submenuId!)).not.toBeNull();
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/settings',
    );
  });

  it('uses the platform palette token for an inactive platform icon', () => {
    const toggle = container.querySelector('button[aria-expanded="false"]');

    expect(toggle).not.toBeNull();
    click(toggle!);

    const icon = container.querySelector('a[href="/collections/bilibili"] .favbase-nav-icon');

    expect(icon).not.toBeNull();
    expect(getComputedStyle(icon!).color).toBe(themeConfig.platform.light.bilibili);
  });

  it('renders the Platform Request action as readable secondary text, not disabled text', () => {
    const toggle = container.querySelector('button[aria-expanded="false"]');

    expect(toggle).not.toBeNull();
    click(toggle!);

    const requestLink = container.querySelector('a[href="https://example.com/request-platform"]');

    expect(requestLink).not.toBeNull();
    expect(requestLink?.getAttribute('target')).toBe('_blank');
    expect(getComputedStyle(requestLink!).color).toBe(themeConfig.scheme.light.text.secondary);
  });

  it('renders compact rows as icon-only links that keep an accessible name', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter initialEntries={['/settings']}>
            <NavDesktop data={COLLECTIONS_NAV} layoutQuery="lg" pinned={false} />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

    const collectionsLink = container.querySelector('a[href="/collections"]');

    expect(collectionsLink).not.toBeNull();
    // Tooltip supplies aria-label from its title when the child has none.
    expect(collectionsLink?.getAttribute('aria-label')).toBeTruthy();
    expect(collectionsLink?.textContent).toBe('');
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('keeps the active platform icon on the shared coral selection color', () => {
    const toggle = container.querySelector('button[aria-expanded="false"]');

    expect(toggle).not.toBeNull();
    click(toggle!);

    const platformLink = container.querySelector('a[href="/collections/bilibili"]');

    expect(platformLink).not.toBeNull();
    click(platformLink!);

    const icon = container.querySelector('a[href="/collections/bilibili"] .favbase-nav-icon');

    expect(icon).not.toBeNull();
    expect(getComputedStyle(icon!).color).toBe(themeConfig.palette.primary.main);
  });
});
