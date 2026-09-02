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
import { navSectionClasses } from '../../components/nav-section';
import type { NavSectionData } from '../../components/nav-section';
import { NavVertical } from './nav-vertical';

// Data arrives translated: `useTranslatedNav` (layout.tsx) is the i18n boundary.
const NAV_DATA: NavSectionData[] = [
  {
    subheader: 'Collections',
    items: [
      {
        title: 'Collections',
        path: '/collections',
        icon: <span />,
        toggleLabel: 'Toggle Collections submenu',
        children: [
          {
            title: 'Bilibili Favorites',
            path: '/collections/bilibili',
            platform: 'bilibili',
            deepMatch: true,
            icon: <span data-testid="platform-icon" />,
          },
          {
            title: 'Request a platform',
            path: 'https://example.com/request-platform',
            external: true,
            caption: 'external',
            icon: <span />,
          },
        ],
      },
    ],
  },
  {
    subheader: 'General',
    items: [{ title: 'Settings', path: '/settings', icon: <span /> }],
  },
];

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

/**
 * The submenu disclosure. Scoped to `<nav>` on purpose: `NavToggleButton` (the
 * rail's own collapse control) is a sibling of the nav and also carries
 * `aria-expanded`.
 */
function disclosure(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('nav button[aria-expanded]');
}

function itemRootOf(link: Element): HTMLElement {
  const root = link.closest(`.${navSectionClasses.item.root}`);
  if (!(root instanceof HTMLElement)) throw new Error('nav item root not found');
  return root;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Collections sidebar navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(isNavMini = false, initialEntry = '/settings') {
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <NavVertical
              data={NAV_DATA}
              layoutQuery="lg"
              isNavMini={isNavMini}
              onToggleNav={() => undefined}
            />
            <LocationProbe />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('navigates to the aggregate page from the Collections parent link', () => {
    render();
    const collectionsLink = container.querySelector('a[href="/collections"]');

    expect(collectionsLink).not.toBeNull();
    click(collectionsLink!);

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/collections');
  });

  it('renders the project logo in the sidebar brand', () => {
    render();
    const logo = container.querySelector('img[src="/icon/128.png"]');

    expect(logo).not.toBeNull();
    expect(logo?.getAttribute('alt')).toBe('');
  });

  it('renders both group subheaders in order, inside their list item', () => {
    render();
    const subheaders = Array.from(
      container.querySelectorAll(`.${navSectionClasses.subheader}`),
    ) as HTMLElement[];

    expect(subheaders.map((node) => node.textContent)).toEqual(['Collections', 'General']);
    expect(subheaders[0].closest('li')).not.toBeNull();
  });

  it('toggles the submenu from the disclosure button without navigating', () => {
    render();
    const toggle = disclosure(container);

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    // D15: the disclosure is a sibling control, so it has its own name.
    expect(toggle?.getAttribute('aria-label')).toBe('Toggle Collections submenu');
    click(toggle!);

    const expandedToggle = disclosure(container);
    const submenuId = expandedToggle?.getAttribute('aria-controls');

    expect(expandedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(submenuId).toBeTruthy();
    expect(document.getElementById(submenuId!)).not.toBeNull();
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
  });

  it('uses the platform palette token for an inactive platform icon', () => {
    render();
    click(disclosure(container)!);

    const icon = container.querySelector(
      `a[href="/collections/bilibili"] .${navSectionClasses.item.icon}`,
    );

    expect(icon).not.toBeNull();
    expect(getComputedStyle(icon!).color).toBe(themeConfig.platform.light.bilibili);
  });

  it('renders the Platform Request action as readable secondary text with a caption', () => {
    render();
    click(disclosure(container)!);

    const requestLink = container.querySelector('a[href="https://example.com/request-platform"]');

    expect(requestLink).not.toBeNull();
    expect(requestLink?.getAttribute('target')).toBe('_blank');
    expect(
      itemRootOf(requestLink!).querySelector(`.${navSectionClasses.item.caption}`)?.textContent,
    ).toBe('external');
    expect(getComputedStyle(itemRootOf(requestLink!)).color).toBe(
      themeConfig.scheme.light.text.secondary,
    );
  });

  it('marks the active row with the active class and the accent ink', () => {
    render(false, '/collections/bilibili/123');

    const platformLink = container.querySelector('a[href="/collections/bilibili"]');
    expect(platformLink).not.toBeNull();

    // deepMatch: a detail route still belongs to its platform leaf.
    const row = itemRootOf(platformLink!);
    expect(row.className).toContain(navSectionClasses.state.active);
    // `--nav-item-sub-active-color` resolves to the derived accent ink, which
    // for the default (coral) preset is `primary.darker` on the light scheme.
    expect(getComputedStyle(row).color).toBe(themeConfig.palette.primary.darker);
  });

  it('renders mini rows as tiles that open their flyout from the keyboard', async () => {
    vi.useFakeTimers();
    render(true);

    const collectionsLink = container.querySelector<HTMLAnchorElement>('a[href="/collections"]');
    expect(collectionsLink).not.toBeNull();
    // Icon plus a 10px title, and the flyout announced on the link itself.
    expect(collectionsLink?.textContent).toContain('Collections');
    expect(collectionsLink?.getAttribute('aria-haspopup')).toBe('true');
    expect(disclosure(container)).toBeNull();

    await act(async () => {
      collectionsLink!.focus();
      collectionsLink!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(1000);
    });

    const dropdownLink = document.body.querySelector<HTMLAnchorElement>(
      `.${navSectionClasses.dropdown.paper} a[href="/collections/bilibili"]`,
    );
    expect(dropdownLink).not.toBeNull();
    expect(document.activeElement).toBe(dropdownLink);
  });
});
