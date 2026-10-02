// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buttonClasses } from '@mui/material/Button';

import { ThemeProvider } from '../../theme/theme-provider';
import { settingsPath } from '../../sections/settings/settings-nav';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keys come back verbatim with each param appended as `|name=value`, so every
// assertion names the locale key the component asked for AND the param name it
// passed (substituting `{{name}}` into a bare key would prove neither). That the
// real strings carry those placeholders is asserted against the locale files
// at the bottom of this file.
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

import {
  EmptyLibraryState,
  NeedsConfigState,
  NotLoggedInState,
  useCollectionChromeCopy,
  type CollectionChromeCopy,
  type SiteAction,
} from './index';
// Pure data (no `@/lib/i18n` index, so no load-time storage read).
import zhCN from '@/lib/i18n/locales/zh-CN';
import en from '@/lib/i18n/locales/en';

const SITE = {
  href: 'https://example.com/saved',
  label: 'x.openBookmarksPage',
  icon: 'mdi:twitter',
} as const satisfies SiteAction;

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

/** Variant is read off MUI's own class constants, never hand-typed class strings. */
function variantOf(element: Element): 'contained' | 'outlined' | 'other' {
  if (element.classList.contains(buttonClasses.contained)) return 'contained';
  if (element.classList.contains(buttonClasses.outlined)) return 'outlined';
  return 'other';
}

describe('collection states', () => {
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

  function render(ui: ReactNode) {
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>
            {ui}
            <LocationProbe />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
  }

  function actions(): HTMLElement[] {
    const box = container.querySelector('[data-state-box]');
    if (!box) throw new Error('no state box');
    return [...box.querySelectorAll<HTMLElement>('a, button')];
  }

  it('renders the shared anatomy: 48px glyph and translated title and description', () => {
    render(
      <EmptyLibraryState
        icon="mdi:star"
        title="githubStars.emptyTitle"
        description="githubStars.emptyDesc"
        syncing={false}
        onSync={vi.fn()}
      />,
    );

    const box = container.querySelector('[data-state-box]');
    expect(box?.querySelector('[data-icon="mdi:star"]')?.getAttribute('data-width')).toBe('48');
    expect(box?.textContent).toContain('githubStars.emptyTitle');
    expect(box?.textContent).toContain('githubStars.emptyDesc');
  });

  it('makes Fetch the one contained action of an empty library with no site to open', () => {
    const onSync = vi.fn();
    render(
      <EmptyLibraryState
        icon="mdi:star"
        title="githubStars.emptyTitle"
        description="githubStars.emptyDesc"
        syncing={false}
        onSync={onSync}
      />,
    );

    const [fetch, ...rest] = actions();
    expect(rest).toHaveLength(0);
    expect(fetch.tagName).toBe('BUTTON');
    expect(fetch.textContent).toBe('pipeline.fetchNow');
    expect(variantOf(fetch)).toBe('contained');

    act(() => fetch.click());
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('disables Fetch while syncing', () => {
    render(
      <EmptyLibraryState
        icon="mdi:star"
        title="githubStars.emptyTitle"
        description="githubStars.emptyDesc"
        syncing
        onSync={vi.fn()}
      />,
    );

    const [fetch] = actions();
    expect((fetch as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    [
      'EmptyLibraryState with a site',
      (onSync: () => void) => (
        <EmptyLibraryState
          icon="mdi:twitter"
          title="x.emptyTitle"
          description="x.emptyDesc"
          site={SITE}
          syncing={false}
          onSync={onSync}
        />
      ),
    ],
    [
      'NotLoggedInState',
      (onSync: () => void) => (
        <NotLoggedInState
          icon="mdi:twitter"
          title="x.notLoggedInTitle"
          description="x.notLoggedInDesc"
          site={SITE}
          syncing={false}
          onSync={onSync}
        />
      ),
    ],
  ])('%s leads with the contained site link and steps Fetch back to outlined', (_name, ui) => {
    const onSync = vi.fn();
    render(ui(onSync));

    const [site, fetch, ...rest] = actions();
    expect(rest).toHaveLength(0);

    expect(site.tagName).toBe('A');
    expect(site.getAttribute('href')).toBe(SITE.href);
    expect(site.getAttribute('target')).toBe('_blank');
    expect(site.getAttribute('rel')).toBe('noopener');
    expect(variantOf(site)).toBe('contained');
    expect(site.textContent).toBe('x.openBookmarksPage');
    expect(site.querySelector('[data-icon="mdi:twitter"]')?.getAttribute('data-width')).toBe('18');

    expect(fetch.tagName).toBe('BUTTON');
    expect(fetch.textContent).toBe('pipeline.fetchNow');
    expect(variantOf(fetch)).toBe('outlined');
    act(() => fetch.click());
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('sends a configuration state to its Connections section, with no Fetch when nothing is configured', () => {
    render(
      <NeedsConfigState
        icon="mdi:youtube"
        title="youtube.notConnectedTitle"
        description="youtube.notConnectedDesc"
        settings="connections/youtube"
      />,
    );

    const [settings, ...rest] = actions();
    expect(rest).toHaveLength(0);
    expect(settings.tagName).toBe('BUTTON');
    expect(settings.textContent).toBe('common.goToSettings');
    expect(variantOf(settings)).toBe('contained');

    act(() => settings.click());
    expect(container.querySelector('[data-testid="location"]')?.textContent)
      .toBe(settingsPath('connections/youtube'));
  });

  it('adds an outlined Fetch after Settings when the credential was rejected', () => {
    const onSync = vi.fn();
    render(
      <NeedsConfigState
        icon="mdi:youtube"
        title="youtube.authFailedTitle"
        description="youtube.authFailedDesc"
        settings="connections/youtube"
        sync={{ syncing: false, onSync }}
      />,
    );

    const [settings, fetch, ...rest] = actions();
    expect(rest).toHaveLength(0);
    expect(settings.textContent).toBe('common.goToSettings');
    expect(variantOf(settings)).toBe('contained');
    expect(fetch.textContent).toBe('pipeline.fetchNow');
    expect(variantOf(fetch)).toBe('outlined');

    act(() => fetch.click());
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

describe('useCollectionChromeCopy', () => {
  it('returns the five chrome strings, interpolating the sync error into the banner', () => {
    const seen: { copy: CollectionChromeCopy | null } = { copy: null };
    function Probe() {
      seen.copy = useCollectionChromeCopy();
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(<Probe />));
    act(() => root.unmount());

    if (!seen.copy) throw new Error('probe did not render');
    const { syncFailed, ...labels } = seen.copy;
    expect(labels).toEqual({
      syncLabel: 'pipeline.fetchNow',
      syncingLabel: 'pipeline.fetching',
      loadFailed: 'common.loadFailed',
      retry: 'common.retry',
    });
    expect(syncFailed('Quota hit')).toBe('common.syncFailed|error=Quota hit');
  });
});

// The mock above proves which param NAME each caller hands `t()`; this proves
// the shared strings carry that placeholder, in both locales. A renamed
// placeholder would otherwise render literally on every collection page.
describe('shared common.* placeholders', () => {
  it.each([
    ['common.syncFailed', '{{error}}'], // useCollectionChromeCopy().syncFailed
    ['common.lastSynced', '{{time}}'], // every view's caption
    ['common.showMore', '{{n}}'], // every CollapsibleChipRow adapter
  ] as const)('%s carries %s in zh-CN and en', (key, placeholder) => {
    expect(zhCN[key]).toContain(placeholder);
    expect(en[key]).toContain(placeholder);
  });
});
