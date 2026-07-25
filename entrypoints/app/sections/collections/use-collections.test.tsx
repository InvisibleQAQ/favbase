// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections';
import type { UsedTag } from '@/lib/tagging';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const knownId = '11111111-1111-4111-8111-111111111111';
const usedTags: UsedTag[] = [{ id: knownId, name: 'frontend', count: 1 }];

const mocks = vi.hoisted(() => ({
  getCollectionItems: vi.fn(async () => ({ rows: [], total: 0 })),
  getAllUsedTags: vi.fn(),
}));

vi.mock('@/lib/collections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/collections')>()),
  getCollectionItems: mocks.getCollectionItems,
}));

vi.mock('@/lib/database', () => ({ initDbProxy: vi.fn(async () => undefined) }));
vi.mock('@/lib/events', () => ({ onDomainEvent: vi.fn(() => () => undefined) }));
vi.mock('@/lib/tagging', () => ({ getAllUsedTags: mocks.getAllUsedTags }));

import { useCollections } from './use-collections';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function Probe() {
  const collections = useCollections();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <output data-search>{location.search}</output>
      <output data-selected>{collections.selectedTagId ?? ''}</output>
      <output data-page>{collections.page}</output>
      <button data-navigate type="button" onClick={() => navigate(`/collections?tag=${knownId}`)}>
        navigate-valid
      </button>
      <button data-select type="button" onClick={() => collections.setSelectedTagId(knownId)}>
        select-known
      </button>
      <button data-clear type="button" onClick={() => collections.setSelectedTagId(null)}>
        clear
      </button>
      <button data-back type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button data-page-three type="button" onClick={() => collections.goToPage(3)}>
        page-three
      </button>
    </div>
  );
}

describe('useCollections URL validation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.getCollectionItems.mockClear();
    mocks.getAllUsedTags.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not let stale validation clean a newer valid tag navigation', async () => {
    const firstUsedTags = deferred<UsedTag[]>();
    mocks.getAllUsedTags
      .mockImplementationOnce(() => firstUsedTags.promise)
      .mockResolvedValue(usedTags);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/collections?tag=not-a-uuid']}>
          <Probe />
        </MemoryRouter>,
      );
    });
    await act(async () => undefined);
    expect(mocks.getAllUsedTags).toHaveBeenCalledTimes(1);
    expect(mocks.getAllUsedTags).toHaveBeenCalledWith(COLLECTION_PLATFORMS);

    act(() => container.querySelector<HTMLButtonElement>('[data-navigate]')?.click());
    await act(async () => undefined);
    expect(mocks.getAllUsedTags).toHaveBeenCalledTimes(2);

    await act(async () => firstUsedTags.resolve(usedTags));
    await act(async () => undefined);

    expect(container.querySelector('[data-search]')?.textContent).toBe(`?tag=${knownId}`);
  });

  it('pushes selection and clearing, resets the page, and restores the tag on back', async () => {
    mocks.getAllUsedTags.mockResolvedValue(usedTags);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/collections']}>
          <Probe />
        </MemoryRouter>,
      );
    });
    await act(async () => undefined);

    act(() => container.querySelector<HTMLButtonElement>('[data-page-three]')?.click());
    expect(container.querySelector('[data-page]')?.textContent).toBe('3');

    act(() => container.querySelector<HTMLButtonElement>('[data-select]')?.click());
    await act(async () => undefined);
    expect(container.querySelector('[data-search]')?.textContent).toBe(`?tag=${knownId}`);
    expect(container.querySelector('[data-selected]')?.textContent).toBe(knownId);
    expect(container.querySelector('[data-page]')?.textContent).toBe('1');

    act(() => container.querySelector<HTMLButtonElement>('[data-clear]')?.click());
    await act(async () => undefined);
    expect(container.querySelector('[data-search]')?.textContent).toBe('');
    expect(container.querySelector('[data-selected]')?.textContent).toBe('');

    act(() => container.querySelector<HTMLButtonElement>('[data-back]')?.click());
    await act(async () => undefined);
    expect(container.querySelector('[data-search]')?.textContent).toBe(`?tag=${knownId}`);
    expect(container.querySelector('[data-selected]')?.textContent).toBe(knownId);
  });
});
