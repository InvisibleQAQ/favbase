// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../theme/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  github: vi.fn(),
  youtube: vi.fn(),
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

vi.mock('../layouts/dashboard', () => ({
  DashboardContent: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

vi.mock('../components/configuration-blocker', () => ({
  CollectionConfigurationNotice: () => null,
}));

vi.mock('../hooks/use-collection-pipeline', () => ({
  useCollectionPipeline: () => ({ coverage: null, coverageStatus: 'loading', segments: [] }),
}));

vi.mock('./github-stars/use-github-stars', () => ({
  useGithubStars: () => mocks.github(),
}));

vi.mock('./youtube/use-youtube-playlists', () => ({
  useYoutubePlaylists: () => mocks.youtube(),
}));

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  formatDateTime: (value: number) => String(value),
  formatCompactNumber: (value: number) => String(value),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    locale: 'en',
    preference: 'en',
    setLocale: vi.fn(),
    t: (key: string) => ({
      'githubStars.title': 'GitHub Stars',
      'githubStars.noTokenTitle': 'Connect GitHub',
      'githubStars.noTokenDesc': 'Add a token to continue.',
      'githubStars.goToSettings': 'Open settings',
      'youtube.title': 'YouTube Playlists',
      'youtube.notConnectedTitle': 'Connect YouTube',
      'youtube.notConnectedDesc': 'Add an API key and channel.',
      'youtube.goToSettings': 'Open settings',
    })[key] ?? key,
  }),
}));

import { GithubStarsView } from './github-stars/github-stars-view';
import { YoutubeView } from './youtube/youtube-view';

describe('platform configuration gates', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.github.mockReturnValue({
      settingsLoading: false,
      hasToken: false,
      syncing: false,
      syncJob: null,
      embedJob: null,
      tagJob: null,
    });
    mocks.youtube.mockReturnValue({
      settingsLoading: false,
      hasConfig: false,
      syncing: false,
      syncJob: null,
      embedJob: null,
      tagJob: null,
    });
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

  it.each([
    ['GitHub', <GithubStarsView />, 'GitHub Stars', 'Connect GitHub'],
    ['YouTube', <YoutubeView />, 'YouTube Playlists', 'Connect YouTube'],
  ])('keeps one route h1 above the %s configuration state', (_platform, view, title, stateTitle) => {
    render(view);

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe(title);
    expect(container.textContent).toContain(stateTitle);
    expect(container.querySelector('[data-state-box]')).not.toBeNull();
  });
});
