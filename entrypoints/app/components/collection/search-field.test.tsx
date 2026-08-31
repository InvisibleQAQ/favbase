// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { SearchField } from './search-field';

describe('SearchField', () => {
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

  it('names the input after its placeholder and forwards typed text', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <ThemeProvider>
          <SearchField placeholder="Search videos" value="" onChange={onChange} />
        </ThemeProvider>,
      );
    });

    const input = container.querySelector('input');
    expect(input?.getAttribute('aria-label')).toBe('Search videos');
    expect(input?.getAttribute('placeholder')).toBe('Search videos');
    expect(input?.hasAttribute('disabled')).toBe(false);
  });

  it('renders a disabled placeholder field when uncontrolled', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SearchField placeholder="Search" disabled />
        </ThemeProvider>,
      );
    });
    expect(container.querySelector('input')?.hasAttribute('disabled')).toBe(true);
  });
});
