// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: () => Promise.resolve('en' as const),
    setValue: () => Promise.resolve(),
    watch: () => () => undefined,
  },
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params?.n == null ? key : `${key}:${params.n}`,
  }),
}));

vi.mock('@/lib/collections', () => ({
  isCollectionPlatform: (platform: string) => platform === 'github',
}));

vi.mock('../../collection-platform-registry', () => ({
  collectionPlatformRegistry: [
    { id: 'github', title: 'platform.github', icon: 'mock:github' },
  ],
}));

vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ThemeProvider } from '../../theme/theme-provider';
import { SourceCards } from './source-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sources = [
  {
    itemId: 'source-1',
    title: 'Open source',
    url: 'https://example.com/open',
    platform: 'github',
    score: 0.83,
  },
  {
    itemId: 'source-2',
    title: 'Unavailable source',
    url: '',
    platform: 'unknown',
    score: 0.41,
  },
];

describe('SourceCards', () => {
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
    vi.restoreAllMocks();
  });

  it('renders sources as a named list with interaction only on openable items', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SourceCards sources={sources} />
        </ThemeProvider>,
      );
    });

    const list = container.querySelector('ul[aria-label="chat.sourcesTitle:2"]');

    expect(list).not.toBeNull();
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(2);
    expect(list?.querySelectorAll('button')).toHaveLength(1);
  });

  it('opens an available source in a protected new tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    act(() => {
      root.render(
        <ThemeProvider>
          <SourceCards sources={sources} />
        </ThemeProvider>,
      );
    });

    act(() => container.querySelector<HTMLButtonElement>('ul button')?.click());

    expect(open).toHaveBeenCalledWith(
      'https://example.com/open',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
