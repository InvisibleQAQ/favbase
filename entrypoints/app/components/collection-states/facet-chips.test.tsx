// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same `t` mock as `collection-states.test.tsx`: keys come back verbatim with
// each param appended as `|name=value`, so assertions name the key and param.
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    locale: 'en',
    preference: 'en',
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, string | number>) => {
      let value = key;
      for (const [name, param] of Object.entries(params ?? {})) {
        value = `${value}|${name}=${String(param)}`;
      }
      return value;
    },
  }),
}));

vi.mock('../iconify', () => ({
  Iconify: ({ icon, width }: { icon: string; width?: number }) => (
    <span data-icon={icon} data-width={width} />
  ),
}));

import { FacetChips } from './index';

interface Facet {
  id: string;
  name: string;
  count: number;
}

const FACETS: Facet[] = [
  { id: 'alice-handle', name: 'Alice', count: 7 },
  { id: 'bob-handle', name: '', count: 3 },
];

describe('FacetChips', () => {
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

  function render(onSelect = vi.fn(), selected: string | null = null) {
    act(() => {
      root.render(
        <ThemeProvider>
          <FacetChips
            icon="mdi:twitter"
            title="x.authorsTitle"
            facets={FACETS}
            getKey={(f) => f.id}
            getName={(f) => f.name}
            totalCount={10}
            selected={selected}
            onSelect={onSelect}
          />
        </ThemeProvider>,
      );
    });
    return onSelect;
  }

  function chips(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.MuiChip-root'));
  }

  it('renders the translated header, the 20px icon and an "All (total)" chip first', () => {
    render();

    expect(container.textContent).toContain('x.authorsTitle');
    expect(container.querySelector('[data-icon="mdi:twitter"]')?.getAttribute('data-width'))
      .toBe('20');
    expect(chips()[0]?.textContent).toBe('common.all (10)');
  });

  it('labels a facet "name (count)"', () => {
    render();

    expect(chips()[1]?.textContent).toBe('Alice (7)');
  });

  it('falls back to the key when the name is empty', () => {
    render();

    expect(chips()[2]?.textContent).toBe('bob-handle (3)');
  });

  it('selects a facet by key and "All" as null', () => {
    const onSelect = render();
    const [all, alice, bob] = chips();

    act(() => alice!.click());
    act(() => bob!.click());
    act(() => all!.click());

    expect(onSelect.mock.calls).toEqual([['alice-handle'], ['bob-handle'], [null]]);
  });
});
