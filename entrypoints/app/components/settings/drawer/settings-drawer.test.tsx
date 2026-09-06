// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same seam as `context/settings-provider.test.tsx`: only WXT's storage is
// stubbed, so the real `lib/storage/theme-settings.ts` facade (canonicalize +
// watch fan-out) runs and every drawer click is asserted against a real write.
const storageMock = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();
  const writes: { key: string; value: unknown }[] = [];
  const notify = (key: string, value: unknown) => {
    for (const watcher of watchers.get(key) ?? []) watcher(value);
  };
  return { store, watchers, writes, notify };
});

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem<T>(key: string, opts?: { fallback?: T }) {
      return {
        async getValue(): Promise<T> {
          return (storageMock.store.has(key) ? storageMock.store.get(key) : opts?.fallback) as T;
        },
        async setValue(value: T): Promise<void> {
          storageMock.writes.push({ key, value });
          storageMock.store.set(key, value);
          storageMock.notify(key, value);
        },
        async removeValue(): Promise<void> {
          storageMock.store.delete(key);
          storageMock.notify(key, opts?.fallback);
        },
        watch(callback: (value: T) => void): () => void {
          const set = storageMock.watchers.get(key) ?? new Set();
          storageMock.watchers.set(key, set);
          set.add(callback as (value: unknown) => void);
          return () => set.delete(callback as (value: unknown) => void);
        },
      };
    },
  },
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    preference: 'auto',
    setLocale: () => undefined,
  }),
}));

import { DEFAULT_THEME_SETTINGS, STORAGE_KEYS } from '@/lib/storage';

import { COLOR_MODE_STORAGE_KEY, ThemeProvider } from '../../../theme/theme-provider';
import { SettingsProvider } from '../context/settings-provider';
import { useSettingsContext } from '../context/use-settings-context';
import { SettingsDrawer } from './settings-drawer';

const KEY = STORAGE_KEYS.themeSettings;

/** Stands in for the header's SettingsButton. */
function Opener() {
  const { onToggleDrawer } = useSettingsContext();
  return (
    <button type="button" data-testid="opener" onClick={onToggleDrawer}>
      open
    </button>
  );
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function buttonByLabel(label: string): HTMLButtonElement {
  const node = dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!node) throw new Error(`no button labelled ${label}`);
  return node;
}

function lastWrite() {
  return storageMock.writes.at(-1);
}

describe('SettingsDrawer', () => {
  let container: HTMLDivElement;
  let root: Root;

  function opener(): HTMLButtonElement {
    const node = container.querySelector<HTMLButtonElement>('[data-testid="opener"]');
    if (!node) throw new Error('no opener');
    return node;
  }

  async function open() {
    await act(async () => {
      opener().focus();
      opener().click();
      await vi.advanceTimersByTimeAsync(1000);
    });
  }

  async function clickInDialog(node: HTMLButtonElement) {
    await act(async () => {
      node.click();
      await vi.advanceTimersByTimeAsync(1000);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    storageMock.store.clear();
    storageMock.watchers.clear();
    storageMock.writes.length = 0;
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <SettingsProvider initialState={{ ...DEFAULT_THEME_SETTINGS }}>
          <ThemeProvider>
            <Opener />
            <SettingsDrawer />
          </ThemeProvider>
        </SettingsProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('opens as a labelled dialog and closes from its close button', async () => {
    expect(dialog()).toBeNull();

    await open();
    expect(dialog()?.getAttribute('aria-label')).toBe('settingsDrawer.title');

    await clickInDialog(buttonByLabel('settingsDrawer.close'));
    expect(dialog()).toBeNull();
    // ui-design-system.md §12: closing a temporary Drawer hands focus back to
    // its trigger and leaves no `aria-hidden` behind. The trigger lives in the
    // header while the drawer is mounted at the router root, so there is no
    // shared ref — MUI's own restore-focus is what has to hold, and this is the
    // assertion that keeps it honest.
    expect(document.activeElement).toBe(opener());
    expect(container.getAttribute('aria-hidden')).toBeNull();
  });

  it('persists a primary preset choice', async () => {
    await open();
    await clickInDialog(buttonByLabel('settingsDrawer.preset2'));

    expect(lastWrite()).toEqual({
      key: KEY,
      value: { ...DEFAULT_THEME_SETTINGS, primaryColor: 'preset2' },
    });
  });

  it('persists the contrast and compact switches', async () => {
    await open();
    await clickInDialog(buttonByLabel('settingsDrawer.contrast'));
    expect(lastWrite()?.value).toEqual({ ...DEFAULT_THEME_SETTINGS, contrast: 'high' });

    await clickInDialog(buttonByLabel('settingsDrawer.compact'));
    expect(lastWrite()?.value).toEqual({
      ...DEFAULT_THEME_SETTINGS,
      contrast: 'high',
      compactLayout: true,
    });
  });

  it('carries no mode control and leaves the color mode alone', async () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    await open();

    // Light/dark is the Header's own button since 2026-09-06 and `system` is
    // gone, so nothing in here may name a mode or touch MUI's key.
    const labels = Array.from(dialog()?.querySelectorAll('button') ?? []).map(
      (node) => `${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`,
    );
    expect(labels.join(' ')).not.toMatch(/mode/i);

    await clickInDialog(buttonByLabel('settingsDrawer.preset2'));
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
  });

  it('resets the persisted settings and hides the dot again', async () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    await open();
    await clickInDialog(buttonByLabel('settingsDrawer.preset2'));

    const reset = buttonByLabel('settingsDrawer.reset');
    expect(reset.querySelector('.MuiBadge-invisible')).toBeNull();

    await clickInDialog(reset);

    expect(lastWrite()?.value).toEqual({ ...DEFAULT_THEME_SETTINGS });
    // The drawer owns no mode option, so "reset all" must not silently repaint
    // the app — that was the bug the old `onResetAll` shipped.
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
    // canReset is back to false, so the dot on "reset all" is hidden again.
    expect(
      buttonByLabel('settingsDrawer.reset').querySelector('.MuiBadge-invisible'),
    ).not.toBeNull();
  });
});
