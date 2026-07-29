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
import type { NavItem } from '../nav-config';
import { NavDesktop } from './nav';

const COLLECTIONS_NAV: NavItem[] = [
  {
    title: 'nav.collections',
    path: '/collections',
    icon: <span />,
    children: [{ title: 'nav.collections', path: '/collections/bilibili' }],
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
});
