// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CollectionAnalyticsSnapshot } from '@/lib/collections';
import { themeConfig } from '../../theme/theme-config';
import { ThemeProvider } from '../../theme/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: vi.fn(async () => 'en'),
    setValue: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  },
  // Pulled in transitively via the components/collection barrel → scaffold →
  // library-gate (module-level getValue + watch on load).
  libraryGateStorage: {
    getValue: vi.fn(async () => []),
    setValue: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  },
}));

vi.mock('../../layouts/dashboard', () => ({
  DashboardContent: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const copy: Record<string, string> = {
  'dashboard.title': 'Library analytics',
  'dashboard.subtitle': 'Current collection composition',
  'dashboard.loading': 'Loading analytics',
  'dashboard.totalItems': 'Items',
  'dashboard.platformsInUse': 'Platforms in use',
  'dashboard.tagCoverage': 'Tag coverage',
  'dashboard.tagCount': '{{value}} tags',
  'dashboard.taggedCount': '{{value}} tagged items',
  'dashboard.noTags': 'No tags in use yet',
  'dashboard.platformComposition': 'Platform composition',
  'dashboard.topTags': 'Top tags',
  'dashboard.platformDetails': 'Platform details',
  'dashboard.emptyTitle': 'No collection data yet',
  'dashboard.emptyDesc': 'Collect content to see analytics.',
  'dashboard.openCollections': 'Open Collections',
  'dashboard.platformEmpty': 'No items on this platform.',
  'dashboard.noDimensionData': 'No category data for these items.',
  'dashboard.openPlatform': 'Open platform',
  'dashboard.itemCount': '{{value}} items',
  'dashboard.dimension.language': 'Languages',
  'common.loadFailed': 'Load failed',
  'common.retry': 'Retry',
  'nav.bilibiliFavorites': 'Bilibili',
  'nav.githubStars': 'GitHub',
  'nav.bookmarks': 'Browser Bookmarks',
  'nav.xBookmarks': 'X',
  'nav.zhihuFavorites': 'Zhihu',
  'nav.youtubePlaylists': 'YouTube',
};

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    locale: 'en',
    preference: 'en',
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, string | number>) => {
      let value = copy[key] ?? key;
      for (const [name, param] of Object.entries(params ?? {})) {
        value = value.replace(`{{${name}}}`, String(param));
      }
      return value;
    },
  }),
}));

import { CollectionAnalyticsContent } from './overview-view';

function emptySnapshot(): CollectionAnalyticsSnapshot {
  const platforms = ['bilibili', 'github', 'bookmarks', 'x', 'zhihu', 'youtube'] as const;
  return {
    totalItems: 0,
    usedTags: 0,
    taggedItems: 0,
    topTags: [],
    platforms: platforms.map((platform) => ({
      platform,
      itemCount: 0,
      share: 0,
      dimensions: [],
    })),
  };
}

/** github = 3 items with one language ranking, every other platform empty. */
function partialSnapshot(): CollectionAnalyticsSnapshot {
  const snapshot = emptySnapshot();
  snapshot.totalItems = 3;
  snapshot.usedTags = 1;
  snapshot.taggedItems = 2;
  snapshot.platforms[1] = {
    ...snapshot.platforms[1],
    itemCount: 3,
    share: 1,
    dimensions: [
      {
        kind: 'language',
        entries: [{ id: 'TypeScript', label: 'TypeScript', itemCount: 3 }],
      },
    ],
  };
  snapshot.topTags = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'frontend',
      itemCount: 2,
    },
  ];
  return snapshot;
}

/** Heading levels in document order, e.g. [1, 2, 2, 3]. */
function headingLevels(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) =>
    Number(heading.tagName.slice(1)),
  );
}

function expectNoHeadingSkip(levels: number[]) {
  expect(levels[0]).toBe(1);
  levels.forEach((level, index) => {
    if (index === 0) return;
    expect(level).toBeLessThanOrEqual(levels[index - 1] + 1);
  });
}

describe('CollectionAnalyticsContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(ui: ReactNode) {
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ThemeProvider>,
      );
    });
  }

  it('renders geometry-aware loading and an actionable error state', () => {
    const retry = vi.fn();
    render(
      <CollectionAnalyticsContent
        snapshot={null}
        loading
        error={null}
        retry={retry}
        selectedPlatform="bilibili"
        selectPlatform={vi.fn()}
      />,
    );
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.getAttribute('role')).toBe('status');
    expect(busy?.getAttribute('aria-label')).toBe('Loading analytics');
    // The route title is real text even while the data loads: still one h1.
    expect(document.querySelectorAll('h1')).toHaveLength(1);

    render(
      <CollectionAnalyticsContent
        snapshot={null}
        loading={false}
        error="database offline"
        retry={retry}
        selectedPlatform="bilibili"
        selectPlatform={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('database offline');
    expect(container.querySelector('[data-state-box]')).not.toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry',
    );
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders the route title through the shared SectionTitleBar with the subtitle as its caption', () => {
    render(
      <CollectionAnalyticsContent
        snapshot={emptySnapshot()}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="bilibili"
        selectPlatform={vi.fn()}
      />,
    );

    const titleBar = container.querySelector('[data-section="title"]');
    expect(titleBar).not.toBeNull();
    expect(titleBar?.querySelector('h1')?.textContent).toBe('Library analytics');
    expect(titleBar?.querySelector('[data-slot="caption"]')?.textContent).toBe(
      'Current collection composition',
    );
    // No page-local <header> duplicating the title block.
    expect(container.querySelector('main > header')).toBeNull();
  });

  it('keeps six accessible platform tabs in the truthful empty state', () => {
    render(
      <CollectionAnalyticsContent
        snapshot={emptySnapshot()}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="bilibili"
        selectPlatform={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('No collection data yet');
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(6);
    expect(tabs[0].getAttribute('aria-controls')).toBe('dashboard-platform-panel-bilibili');
    expect(tabs.slice(1).every((tab) => !tab.hasAttribute('aria-controls'))).toBe(true);
    expect(container.querySelector('a[href="/collections"]')).not.toBeNull();
    // The zero-tag state is carried by the summary band; no empty Top tags section.
    expect(container.textContent).toContain('No tags in use yet');
    expect(container.textContent).not.toContain('Top tags');
    // Zero share → no share bar at all (no 1px fake bars).
    expect(container.querySelectorAll('[data-slot="share-bar"]')).toHaveLength(0);
    const shareLabels = Array.from(container.querySelectorAll('[data-slot="share-label"]'));
    expect(shareLabels).toHaveLength(6);
    expect(shareLabels.every((label) => getComputedStyle(label).color === themeConfig.scheme.light.text.primary)).toBe(true);
    // The selected empty platform explains itself inside the tabpanel.
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      'No items on this platform.',
    );
    expectNoHeadingSkip(headingLevels(container));
  });

  it('renders real metrics and top-tag drill-down links', () => {
    render(
      <CollectionAnalyticsContent
        snapshot={partialSnapshot()}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="github"
        selectPlatform={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('1 / 6');
    expect(container.textContent).toContain('66.7%');
    expect(container.textContent).toContain('1 tags · 2 tagged items');
    expect(container.textContent).not.toContain('No tags in use yet');
    expect(container.textContent).toContain('frontend');
    expect(
      container.querySelector(
        'a[href="/collections?tag=11111111-1111-4111-8111-111111111111"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('TypeScript');
    // Only the one populated platform draws a share bar.
    expect(container.querySelectorAll('[data-slot="share-bar"]')).toHaveLength(1);
  });

  it('keeps the heading outline h1 → h2 (sections) → h3 (rankings) without skips', () => {
    render(
      <CollectionAnalyticsContent
        snapshot={partialSnapshot()}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="github"
        selectPlatform={vi.fn()}
      />,
    );

    const levels = headingLevels(container);
    // h1 title, h2 composition, h2 platform name, h3 ranking, h2 top tags.
    expect(levels).toEqual([1, 2, 2, 3, 2]);
    expectNoHeadingSkip(levels);
    expect(container.querySelector('h3')?.textContent).toBe('Languages');
  });

  it('tells the reader when a populated platform has no dimension data, and when a sibling platform is empty', () => {
    const snapshot = partialSnapshot();
    snapshot.platforms[1] = { ...snapshot.platforms[1], dimensions: [] };

    render(
      <CollectionAnalyticsContent
        snapshot={snapshot}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="github"
        selectPlatform={vi.fn()}
      />,
    );
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).toContain('3 items');
    expect(panel?.textContent).toContain('No category data for these items.');
    expect(panel?.querySelector('[data-state-box]')).toBeNull();
    expect(container.querySelector('a[href="/collections/github"]')).not.toBeNull();

    render(
      <CollectionAnalyticsContent
        snapshot={snapshot}
        loading={false}
        error={null}
        retry={vi.fn()}
        selectedPlatform="x"
        selectPlatform={vi.fn()}
      />,
    );
    const emptyPanel = container.querySelector('[role="tabpanel"]');
    expect(emptyPanel?.id).toBe('dashboard-platform-panel-x');
    expect(emptyPanel?.querySelector('[data-state-box]')?.textContent).toContain(
      'No items on this platform.',
    );
    // The library-level empty state is not shown: the library itself is not empty.
    expect(container.textContent).not.toContain('No collection data yet');
  });
});
