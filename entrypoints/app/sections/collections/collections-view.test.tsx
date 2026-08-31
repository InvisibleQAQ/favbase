// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import type { UseCollectionsReturn } from './use-collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  useCollections: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: vi.fn(async () => 'en'),
    setValue: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  },
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
  Iconify: ({ icon, width }: { icon: string; width?: number }) => (
    <span data-icon={icon} data-width={width} />
  ),
}));

vi.mock('../../components/tags', () => ({
  TagEditPopover: () => null,
}));

vi.mock('../../collection-platform-registry', () => ({
  collectionPlatformRegistry: [
    { id: 'bilibili', title: 'nav.bilibiliFavorites' },
    { id: 'github', title: 'nav.githubStars' },
  ],
}));

vi.mock('./collection-item-card', () => ({
  CollectionItemCard: () => <article data-collection-item-card />,
}));

vi.mock('./use-collections', () => ({
  useCollections: () => mocks.useCollections(),
}));

const copy: Record<string, string> = {
  'allCollections.title': 'All collections',
  'allCollections.count': '{{count}} items',
  'allCollections.searchPlaceholder': 'Search collections',
  'allCollections.platformsTitle': 'Platforms',
  'allCollections.allPlatforms': 'All platforms',
  'allCollections.showMorePlatforms': 'Show {{n}} more',
  'allCollections.showLessPlatforms': 'Show less',
  'allCollections.allTags': 'All tags',
  'allCollections.emptyTitle': 'No collections yet',
  'allCollections.emptyDesc': 'Fetch a platform to start.',
  'allCollections.noMatches': 'No collections match.',
  'tags.sectionTitle': 'Tags',
  'tags.showMore': 'Show {{n}} more',
  'tags.showLess': 'Show less',
  'tags.clearFilter': 'Clear',
  'common.loadFailed': 'Load failed',
  'common.retry': 'Retry',
  'nav.bilibiliFavorites': 'Bilibili',
  'nav.githubStars': 'GitHub',
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

import { CollectionsView } from './collections-view';

const noop = vi.fn();

function state(overrides: Partial<UseCollectionsReturn> = {}): UseCollectionsReturn {
  return {
    items: [],
    total: 0,
    totalPages: 1,
    loading: false,
    queryError: null,
    retryQuery: noop,
    usedTags: [],
    selectedTagId: null,
    setSelectedTagId: noop,
    platform: null,
    setPlatform: noop,
    searchInput: '',
    setSearchInput: noop,
    hasActiveFilter: false,
    page: 1,
    goToPage: noop,
    ...overrides,
  };
}

describe('CollectionsView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.useCollections.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>
            <CollectionsView />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
  }

  it('keeps one route h1 and uses eight shared collection-card skeletons while loading', () => {
    mocks.useCollections.mockReturnValue(state({ loading: true }));
    render();

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('All collections');
    expect(container.querySelectorAll('[data-collection-card-skeleton]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-collection-card-skeleton] [data-slot="header"]'))
      .toHaveLength(8);
  });

  it('renders the shared empty state with a 48px secondary information glyph', () => {
    mocks.useCollections.mockReturnValue(state());
    render();

    const empty = container.querySelector('[data-state-box]');
    expect(empty?.textContent).toContain('No collections yet');
    expect(empty?.querySelector('[data-icon="solar:video-library-bold-duotone"]')?.getAttribute('data-width'))
      .toBe('48');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});
