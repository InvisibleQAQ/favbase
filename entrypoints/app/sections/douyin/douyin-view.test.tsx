// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Flat-platform views had no test of their own before this one; it follows
// sections/configuration-heading.test.tsx: the data hook is faked, the guide
// states and chips render for real, and the scaffold is replaced by a probe
// that records the props the view assembles and renders the slots.

interface ScaffoldProps {
  authFailed: boolean;
  libraryCount: number;
  syncDisabled?: boolean;
  syncDisabledLabel?: string;
  pipeline?: ReactNode;
  configurationNotice?: ReactNode;
  authFailedState?: ReactNode;
  emptyState: ReactNode;
  primaryCategory: ReactNode;
  copy: { title: string; caption?: string; syncErrorText: string };
}

const mocks = vi.hoisted(() => ({
  douyin: vi.fn(),
  scaffold: { last: null as ScaffoldProps | null },
}));

vi.mock('./use-douyin-favorites', () => ({ useDouyinFavorites: () => mocks.douyin() }));

vi.mock('../../components/collection', () => ({
  CollectionPageScaffold: (props: ScaffoldProps) => {
    mocks.scaffold.last = props;
    return (
      <div>
        <div data-slot="auth">{props.authFailed ? props.authFailedState : null}</div>
        <div data-slot="empty">
          {props.libraryCount === 0 && !props.authFailed ? props.emptyState : null}
        </div>
        <div data-slot="primary">{props.primaryCategory}</div>
      </div>
    );
  },
  PipelineProgressStrip: () => <div data-slot="pipeline" />,
  CollectionCard: () => null,
  CoverBadge: () => null,
  CardGridSkeleton: () => null,
  CollectionCardSkeleton: () => null,
}));

vi.mock('../../components/tags', () => ({
  taggedCard: () => () => null,
  TagRow: () => null,
}));

vi.mock('../../components/configuration-blocker', () => ({
  CollectionConfigurationNotice: () => <div data-slot="configuration-notice" />,
}));

vi.mock('../../hooks/use-collection-pipeline', () => ({
  useCollectionPipeline: () => ({ coverage: null, coverageStatus: 'loading', segments: [] }),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

// The card's lib mapper only; the view never touches the database.
vi.mock('@/lib/douyin/douyin-sync-service', () => ({ toDouyinItem: vi.fn() }));

// Keys come back verbatim with each param appended as `|name=value`.
function fakeT(key: string, params?: Record<string, string | number>): string {
  let value = key;
  for (const [name, param] of Object.entries(params ?? {})) value = `${value}|${name}=${String(param)}`;
  return value;
}

vi.mock('@/lib/i18n', () => ({
  t: fakeT,
  formatDateTime: (value: number) => `date:${value}`,
  formatCompactNumber: (value: number) => String(value),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ locale: 'en', preference: 'en', setLocale: vi.fn(), t: fakeT }),
}));

import { DouyinView } from './douyin-view';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    filter: null,
    setFilter: vi.fn(),
    facets: [],
    libraryCount: 0,
    lastSyncedAt: null,
    loading: false,
    metaLoading: false,
    syncing: false,
    queryError: null,
    syncError: null,
    syncJob: null,
    embedJob: null,
    tagJob: null,
    page: 1,
    totalPages: 1,
    goToPage: vi.fn(),
    sync: vi.fn(),
    retryQuery: vi.fn(),
    searchInput: '',
    setSearchInput: vi.fn(),
    ...overrides,
  };
}

describe('DouyinView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.scaffold.last = null;
    mocks.douyin.mockReturnValue(hookState());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render() {
    act(() => {
      root.render(
        <ThemeProvider>
          <DouyinView />
        </ThemeProvider>,
      );
    });
    const props = mocks.scaffold.last;
    if (!props) throw new Error('scaffold not rendered');
    return props;
  }

  it('without a usable douyin.com tab, guides the user to open Douyin and keep the tab open', () => {
    mocks.douyin.mockReturnValue(
      hookState({
        syncError: { kind: 'auth', reason: 'missing', message: 'No usable www.douyin.com tab is open' },
      }),
    );

    const props = render();

    const state = container.querySelector('[data-slot="auth"]');
    expect(state?.textContent).toContain('douyin.notLoggedInTitle');
    expect(state?.textContent).toContain('douyin.notLoggedInDesc');
    const link = state?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.douyin.com/');
    expect(link?.textContent).toBe('douyin.openDouyin');
    // Fetch sits beside it, for after the tab is open.
    expect(state?.textContent).toContain('pipeline.fetchNow');
    expect(props.copy.syncErrorText).toBe('douyin.notLoggedInTitle');
    // The auth phase owns the page: no pipeline row, the notice still passed.
    expect(props.pipeline).toBeUndefined();
    expect(props.configurationNotice).toBeDefined();
  });

  it('an empty library also leads with opening Douyin', () => {
    render();

    const state = container.querySelector('[data-slot="empty"]');
    expect(state?.textContent).toContain('douyin.emptyTitle');
    expect(state?.querySelector('a')?.getAttribute('href')).toBe('https://www.douyin.com/');
  });

  it('passes both optional scaffold slots (pipeline and configuration notice)', () => {
    const props = render();

    expect(props.pipeline).toBeDefined();
    expect(props.configurationNotice).toBeDefined();
    expect(props.syncDisabled).toBe(false);
    expect(props.syncDisabledLabel).toBeUndefined();
  });

  it('locks Fetch with a countdown during a cooldown, and says when to retry', () => {
    const resetAt = new Date(NOW + 65_000);
    mocks.douyin.mockReturnValue(
      hookState({ libraryCount: 3, syncError: { kind: 'rate-limit', resetAt, message: 'HTTP 403' } }),
    );

    const props = render();

    expect(props.syncDisabled).toBe(true);
    expect(props.syncDisabledLabel).toBe('pipeline.fetchAvailableIn|time=1:05');
    expect(props.copy.syncErrorText).toBe(`douyin.rateLimited|reset=date:${resetAt.getTime()}`);
  });

  it('a verification page (no reset) does not lock Fetch and asks for the check in the Douyin tab', () => {
    mocks.douyin.mockReturnValue(
      hookState({
        libraryCount: 3,
        syncError: { kind: 'rate-limit', resetAt: null, message: 'verification required' },
      }),
    );

    const props = render();

    expect(props.syncDisabled).toBe(false);
    expect(props.copy.syncErrorText).toBe('douyin.verificationRequired');
  });

  it('renders the public-folder chips with counts once the library has items', () => {
    mocks.douyin.mockReturnValue(
      hookState({
        libraryCount: 5,
        facets: [
          { folderId: '7400000000000000001', title: 'Cooking', count: 3 },
          { folderId: '7400000000000000002', title: '', count: 1 },
        ],
      }),
    );

    const props = render();

    const chips = Array.from(
      container.querySelectorAll('[data-slot="primary"] .MuiChip-label'),
      (chip) => chip.textContent,
    );
    expect(chips).toEqual(['common.all (5)', 'Cooking (3)', '7400000000000000002 (1)']);
    expect(props.copy.caption).toBe('douyin.count|count=5 · douyin.sortedByPublishTime');
  });

  it('shows no chip row before anything is stored', () => {
    render();

    expect(container.querySelector('[data-slot="primary"]')?.children).toHaveLength(0);
  });
});
