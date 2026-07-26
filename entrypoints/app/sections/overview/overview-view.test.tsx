// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CollectionAnalyticsSnapshot } from '@/lib/collections';
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
  'dashboard.totalItems': 'Items',
  'dashboard.usedTags': 'Used tags',
  'dashboard.taggedItems': 'Tagged items',
  'dashboard.platformComposition': 'Platform composition',
  'dashboard.topTags': 'Top tags',
  'dashboard.platformDetails': 'Platform details',
  'dashboard.emptyTitle': 'No collection data yet',
  'dashboard.emptyDesc': 'Collect content to see analytics.',
  'dashboard.openCollections': 'Open Collections',
  'dashboard.platformEmpty': 'No items on this platform.',
  'dashboard.openPlatform': 'Open platform',
  'dashboard.itemCount': '{{value}} items',
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
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

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
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry',
    );
    act(() => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
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
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(6);
    expect(tabs[0].getAttribute('aria-controls')).toBe('dashboard-platform-panel-bilibili');
    expect(tabs.slice(1).every((tab) => !tab.hasAttribute('aria-controls'))).toBe(true);
    expect(container.querySelector('a[href="/collections"]')).not.toBeNull();
  });

  it('renders real metrics and top-tag drill-down links', () => {
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

    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('frontend');
    expect(
      container.querySelector(
        'a[href="/collections?tag=11111111-1111-4111-8111-111111111111"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('TypeScript');
  });
});
