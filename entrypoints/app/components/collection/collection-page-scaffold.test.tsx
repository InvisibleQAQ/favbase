// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tagState = vi.hoisted(() => ({ selectedTagIds: [] as number[] }));

interface FakeGate {
  paused: boolean;
  pause: () => void;
  resume: () => void;
  fetchBlockedHint: string;
}
const gateState = vi.hoisted(() => ({ gate: null as FakeGate | null }));
const titleBarProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('../../layouts/dashboard', () => ({
  DashboardContent: ({ children }: { children: ReactNode }) => (
    <main data-testid="dashboard">{children}</main>
  ),
}));

vi.mock('../tags', () => ({
  useCollectionTags: () => ({
    tagsById: {},
    editing: null,
    openTagEditor: vi.fn(),
    closeTagEditor: vi.fn(),
    usedTags: [],
    selectedTagIds: tagState.selectedTagIds,
    toggleTag: vi.fn(),
    clearTags: vi.fn(),
    handleTagsChanged: vi.fn(),
  }),
  TagFilterChips: () => <div data-section="tags" />,
  TaggedItemGrid: () => <div data-section="content" />,
  TagEditPopover: () => null,
}));

vi.mock('./section-title-bar', () => ({
  SectionTitleBar: (props: Record<string, unknown>) => {
    titleBarProps.last = props;
    return <div data-section="title" />;
  },
}));

// Smart library-gate module (own t() + storage-backed hook) — stubbed so the
// scaffold contract test controls the paused state deterministically.
vi.mock('../library-gate', () => ({
  useCollectionGate: () => gateState.gate,
  LibraryGateButton: () => <button data-testid="gate-button" />,
}));

vi.mock('./search-field', () => ({
  SearchField: () => <div data-section="search" />,
}));

vi.mock('./card-grid', () => ({
  CardGrid: ({ children }: { children: ReactNode }) => (
    <div data-section="content">{children}</div>
  ),
  CardGridItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardGridPagination: () => null,
}));

vi.mock('./error-state', () => ({
  ErrorState: () => <div data-section="content" />,
}));

vi.mock('./no-matches-state', () => ({
  NoMatchesState: () => <div data-section="content" />,
}));

import { CollectionPageScaffold } from './collection-page-scaffold';

const baseProps = {
  platform: 'test',
  items: [{ id: 'row-1' }],
  getRowKey: (item: { id: string }) => item.id,
  getTagId: (item: { id: string }) => item.id,
  libraryCount: 1,
  loading: false,
  metaLoading: false,
  syncing: false,
  queryError: null,
  hasSyncError: false,
  authFailed: false,
  page: 1,
  totalPages: 1,
  onPageChange: vi.fn(),
  onSync: vi.fn(),
  onRetryQuery: vi.fn(),
  searchInput: '',
  onSearchInput: vi.fn(),
  copy: {
    title: 'Title',
    searchPlaceholder: 'Search',
    noMatches: 'None',
    syncLabel: 'Sync',
    syncingLabel: 'Syncing',
    loadFailed: 'Failed',
    retry: 'Retry',
    syncErrorText: 'Sync failed',
    syncFailedBanner: 'Sync failed',
  },
  renderCard: () => <div />,
  renderTaggedCard: () => <div />,
  skeleton: <div data-section="content" />,
  primaryCategory: <div data-section="primary-category" />,
  emptyState: <div data-section="content" />,
};

function directSectionOrder(container: HTMLElement): string[] {
  const dashboard = container.querySelector('[data-testid="dashboard"]');
  if (!dashboard) throw new Error('dashboard not rendered');
  return Array.from(dashboard.children)
    .map((element) => element.getAttribute('data-section'))
    .filter((section): section is string => section != null);
}

describe('CollectionPageScaffold section contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    tagState.selectedTagIds = [];
    gateState.gate = null;
    titleBarProps.last = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the shared sections in the canonical order', () => {
    act(() => {
      root.render(
        <CollectionPageScaffold
          {...baseProps}
          pipeline={<div data-section="pipeline" />}
          configurationNotice={<div data-section="configuration-notice" />}
          operation={<div data-section="operation" />}
          secondaryCategory={<div data-section="secondary-category" />}
        />,
      );
    });

    expect(directSectionOrder(container)).toEqual([
      'title',
      'pipeline',
      'search',
      'configuration-notice',
      'operation',
      'primary-category',
      'tags',
      'secondary-category',
      'content',
    ]);
  });

  it('does not render containers for omitted optional sections', () => {
    act(() => root.render(<CollectionPageScaffold {...baseProps} />));

    expect(directSectionOrder(container)).toEqual([
      'title',
      'search',
      'primary-category',
      'tags',
      'content',
    ]);
  });

  it('wraps the pipeline slot in one row that also hosts the library-gate toggle', () => {
    act(() => {
      root.render(
        <CollectionPageScaffold {...baseProps} pipeline={<div data-strip />} />,
      );
    });

    // Still exactly ONE direct pipeline node in the section order…
    const row = container.querySelector('[data-section="pipeline"]');
    expect(row).not.toBeNull();
    // …containing both the platform strip and the gate button.
    expect(row?.querySelector('[data-strip]')).not.toBeNull();
    expect(row?.querySelector('[data-testid="gate-button"]')).not.toBeNull();
  });

  it('disables fetch with the pause hint while the gate is paused (pause wins over cooldown)', () => {
    gateState.gate = {
      paused: true,
      pause: vi.fn(),
      resume: vi.fn(),
      fetchBlockedHint: 'Paused hint',
    };

    act(() => {
      root.render(
        <CollectionPageScaffold
          {...baseProps}
          syncDisabled={false}
          syncDisabledLabel="cooldown 4:59"
        />,
      );
    });

    expect(titleBarProps.last).toMatchObject({
      syncDisabled: true,
      // Pause keeps the fetch label; the cooldown countdown never shows.
      syncDisabledLabel: undefined,
      syncDisabledTooltip: 'Paused hint',
    });
  });

  it('passes the adapter cooldown through untouched while the gate runs', () => {
    gateState.gate = {
      paused: false,
      pause: vi.fn(),
      resume: vi.fn(),
      fetchBlockedHint: 'Paused hint',
    };

    act(() => {
      root.render(
        <CollectionPageScaffold
          {...baseProps}
          syncDisabled
          syncDisabledLabel="cooldown 4:59"
        />,
      );
    });

    expect(titleBarProps.last).toMatchObject({
      syncDisabled: true,
      syncDisabledLabel: 'cooldown 4:59',
      syncDisabledTooltip: undefined,
    });
  });

  it('keeps page operations but hides primary-category scoped sections during tag takeover', () => {
    tagState.selectedTagIds = [1];

    act(() => {
      root.render(
        <CollectionPageScaffold
          {...baseProps}
          operation={<div data-section="operation" />}
          secondaryCategory={<div data-section="secondary-category" />}
          secondaryCategoryScope="primary-category"
        />,
      );
    });

    expect(directSectionOrder(container)).toEqual([
      'title',
      'search',
      'operation',
      'primary-category',
      'tags',
      'content',
    ]);
  });
});
