// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CooperativeCheckpoint } from '@/lib/collections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/database', () => ({
  initDbProxy: vi.fn(async () => ({})),
}));

import {
  useCollectionLibrary,
  type CollectionQueryParams,
  type UseCollectionLibraryReturn,
} from './use-collection-library';

type Lib = UseCollectionLibraryReturn<string, never, void, string>;

/** Page size the probe queries with — distinguishes page queries from the
 * unfiltered `pageSize: 1` library-count probe in `refreshMeta`. */
const PAGE_SIZE = 10;

const queryFn = vi.fn(async (_params: CollectionQueryParams) => ({ rows: [] as string[], total: 0 }));
const facetsFn = vi.fn(async (): Promise<never[]> => []);
const lastSyncedFn = vi.fn(async (): Promise<Date | null> => null);
const syncFn = vi.fn(
  async (_onProgress: (progress: void) => void, _control: CooperativeCheckpoint) => {},
);
const classifyError = (err: unknown): string => String(err);

function pageQueries(): CollectionQueryParams[] {
  return queryFn.mock.calls.map(([params]) => params).filter((p) => p.pageSize === PAGE_SIZE);
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useCollectionLibrary filter ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Lib;
  let tag = 0;
  let logTag: string;

  function Probe({ controlledFilter }: { controlledFilter?: string | null }) {
    latest = useCollectionLibrary<string, never, void, string>({
      queryFn,
      facetsFn,
      lastSyncedFn,
      syncFn,
      classifyError,
      logTag,
      pageSize: PAGE_SIZE,
      controlledFilter,
    });
    return null;
  }

  beforeEach(() => {
    queryFn.mockClear();
    facetsFn.mockClear();
    lastSyncedFn.mockClear();
    syncFn.mockClear();
    // Distinct job namespace per test — the background-jobs store is a module singleton.
    tag += 1;
    logTag = `lib-test-${tag}`;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uncontrolled: setFilter owns the filter and resets to page 1', async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    await flush();
    expect(latest.filter).toBeNull();

    act(() => latest.goToPage(3));
    await flush();
    expect(latest.page).toBe(3);

    act(() => latest.setFilter('a'));
    await flush();

    expect(latest.filter).toBe('a');
    expect(latest.page).toBe(1);
    expect(pageQueries().at(-1)).toMatchObject({ filter: 'a', page: 1 });
  });

  it('controlled: the filter follows the prop and a change resets to page 1 without a stale-page query', async () => {
    await act(async () => {
      root.render(<Probe controlledFilter="a" />);
    });
    await flush();
    expect(latest.filter).toBe('a');
    expect(pageQueries().at(-1)).toMatchObject({ filter: 'a', page: 1 });

    act(() => latest.goToPage(3));
    await flush();
    expect(pageQueries().at(-1)).toMatchObject({ filter: 'a', page: 3 });

    await act(async () => {
      root.render(<Probe controlledFilter="b" />);
    });
    await flush();

    expect(latest.filter).toBe('b');
    expect(latest.page).toBe(1);
    expect(pageQueries().at(-1)).toMatchObject({ filter: 'b', page: 1 });
    // One source of truth: the page reset happens during the same render that
    // adopts the new filter, so no query ever runs with (new filter, old page).
    expect(pageQueries()).not.toContainEqual(expect.objectContaining({ filter: 'b', page: 3 }));
  });

  it('controlled: null means "no filter" and setFilter is a no-op', async () => {
    await act(async () => {
      root.render(<Probe controlledFilter={null} />);
    });
    await flush();
    expect(latest.filter).toBeNull();

    act(() => latest.setFilter('z'));
    await flush();

    expect(latest.filter).toBeNull();
    expect(pageQueries()).not.toContainEqual(expect.objectContaining({ filter: 'z' }));
  });
});
