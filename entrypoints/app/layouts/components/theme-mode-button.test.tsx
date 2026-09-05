// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    preference: 'auto',
    setLocale: () => undefined,
  }),
}));

// Which glyph is rendered is half the contract, and @iconify/react only puts the
// icon's *prefix* into its class name — surface the full name instead.
vi.mock('../../components/iconify', () => ({
  Iconify: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { COLOR_MODE_STORAGE_KEY, ThemeProvider } from '../../theme/theme-provider';
import { ThemeModeButton } from './theme-mode-button';

describe('ThemeModeButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  /** happy-dom reports `prefers-color-scheme: light`, so `system` resolves light. */
  function render(storedMode: 'light' | 'dark' | 'system') {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, storedMode);
    act(() => {
      root.render(
        <ThemeProvider>
          <ThemeModeButton />
        </ThemeProvider>,
      );
    });
  }

  function button(): HTMLButtonElement {
    const node = container.querySelector<HTMLButtonElement>('button');
    if (!node) throw new Error('no theme mode button');
    return node;
  }

  function icon(): string | null {
    return container.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null;
  }

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers dark mode while light is showing', () => {
    render('light');

    // The glyph is the target mode, and the label says what the click does.
    expect(icon()).toBe('custom:moon-color');
    expect(button().getAttribute('aria-label')).toBe('header.themeToDark');
  });

  it('offers light mode while dark is showing', () => {
    render('dark');

    expect(icon()).toBe('custom:sun-color');
    expect(button().getAttribute('aria-label')).toBe('header.themeToLight');
  });

  it('writes an explicit mode from system, never system itself', () => {
    render('system');
    // Resolved appearance, not the preference: `system` is light here.
    expect(icon()).toBe('custom:moon-color');

    act(() => button().click());

    // Mode is MUI's own key (docs/25 D13); `system` stays reachable only from
    // the appearance drawer, so a click must leave a two-state value behind.
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');
    expect(icon()).toBe('custom:sun-color');
    expect(button().getAttribute('aria-label')).toBe('header.themeToLight');
  });

  it('toggles back to light on the next click', () => {
    render('dark');

    act(() => button().click());

    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light');
    expect(icon()).toBe('custom:moon-color');
  });
});
