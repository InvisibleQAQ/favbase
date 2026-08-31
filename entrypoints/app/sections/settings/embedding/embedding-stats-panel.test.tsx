// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: () => Promise.resolve('en' as const),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

import { ThemeProvider } from '../../../theme/theme-provider';
import { EmbeddingStatsPanel } from './embedding-stats-panel';

describe('EmbeddingStatsPanel', () => {
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

  it('keeps metric figures out of the document heading outline', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <EmbeddingStatsPanel
            stats={{ embeddedChunks: 3, totalChunks: 5 }}
            isRebuilding={false}
            progress={null}
            outcome={null}
            error={null}
            onRebuild={vi.fn()}
          />
        </ThemeProvider>,
      );
    });

    expect(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('p')).map((node) => node.textContent)).toEqual(
      expect.arrayContaining(['3', '5']),
    );
  });
});
