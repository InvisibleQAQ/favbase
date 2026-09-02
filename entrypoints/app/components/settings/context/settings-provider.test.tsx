// @vitest-environment happy-dom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTheme, type Theme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only WXT's storage is stubbed (chrome.storage is absent in vitest); the real
// `lib/storage/theme-settings.ts` facade runs, so canonicalization and the
// watch fan-out are exercised end to end. `setValue` notifies watchers
// synchronously the way chrome.storage.onChanged reaches this context.
// Every render goes through `<StrictMode>` like `main.tsx`, so the write and
// render counts below hold under the double-invoked effects/renders too.
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

import { DEFAULT_THEME_SETTINGS, STORAGE_KEYS, type ThemeSettings } from '@/lib/storage';

import { ThemeProvider } from '../../../theme/theme-provider';
import { SettingsProvider } from './settings-provider';
import { useSettingsContext } from './use-settings-context';

import type { SettingsContextValue } from '../types';

const KEY = STORAGE_KEYS.themeSettings;
const PRESET2: ThemeSettings = { primaryColor: 'preset2', contrast: 'default', compactLayout: false };

/** Exposes the latest context value and counts renders. */
function Probe({ onRender }: { onRender: (value: SettingsContextValue) => void }) {
  const value = useSettingsContext();
  onRender(value);
  return <output data-preset={value.state.primaryColor} data-can-reset={String(value.canReset)} />;
}

function ThemeProbe({ onTheme }: { onTheme: (theme: Theme) => void }) {
  onTheme(useTheme());
  return null;
}

describe('SettingsProvider', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: SettingsContextValue | undefined;
  let renders: number;

  const onRender = (value: SettingsContextValue) => {
    latest = value;
    renders += 1;
  };

  beforeEach(() => {
    storageMock.store.clear();
    storageMock.watchers.clear();
    storageMock.writes.length = 0;
    latest = undefined;
    renders = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mount(initialState: ThemeSettings = DEFAULT_THEME_SETTINGS) {
    act(() => {
      root.render(
        <StrictMode>
          <SettingsProvider initialState={initialState}>
            <Probe onRender={onRender} />
          </SettingsProvider>
        </StrictMode>,
      );
    });
  }

  it('starts from the injected initial state without touching storage', () => {
    mount(PRESET2);
    expect(latest?.state).toEqual(PRESET2);
    expect(latest?.canReset).toBe(true);
    expect(storageMock.writes).toHaveLength(0);
  });

  it('setField updates the state and persists exactly one write per user action', () => {
    mount();
    expect(latest?.canReset).toBe(false);

    act(() => latest?.setField('primaryColor', 'preset2'));

    expect(latest?.state).toEqual(PRESET2);
    expect(latest?.canReset).toBe(true);
    expect(container.querySelector('output')?.dataset.preset).toBe('preset2');
    expect(storageMock.writes).toEqual([{ key: KEY, value: PRESET2 }]);
    expect(storageMock.store.get(KEY)).toEqual(PRESET2);
  });

  it('setState with an unchanged value is a no-op (no render, no write)', () => {
    mount();
    const before = renders;

    act(() => latest?.setState({ contrast: 'default' }));

    expect(renders).toBe(before);
    expect(storageMock.writes).toHaveLength(0);
  });

  it('onReset returns to the defaults, persists them and clears canReset', () => {
    mount();
    act(() => latest?.setState({ primaryColor: 'preset4', contrast: 'high', compactLayout: true }));
    expect(latest?.canReset).toBe(true);

    act(() => latest?.onReset());

    expect(latest?.state).toEqual(DEFAULT_THEME_SETTINGS);
    expect(latest?.canReset).toBe(false);
    expect(storageMock.writes).toHaveLength(2);
    expect(storageMock.writes[1]).toEqual({ key: KEY, value: DEFAULT_THEME_SETTINGS });
  });

  it('adopts an external storage change and canonicalizes it', () => {
    mount();

    act(() => storageMock.notify(KEY, { primaryColor: 'preset3', contrast: 'nope', compactLayout: true }));

    expect(latest?.state).toEqual({ primaryColor: 'preset3', contrast: 'default', compactLayout: true });
    // Adopting a foreign write must not write it back.
    expect(storageMock.writes).toHaveLength(0);
  });

  it('ignores watch echoes that equal the current state', () => {
    mount();
    act(() => latest?.setField('compactLayout', true));
    const before = renders;

    // The storage echo of our own write, then a duplicate from another context.
    act(() => storageMock.notify(KEY, { ...DEFAULT_THEME_SETTINGS, compactLayout: true }));
    act(() => storageMock.notify(KEY, { ...DEFAULT_THEME_SETTINGS, compactLayout: true }));

    expect(renders).toBe(before);
    expect(storageMock.writes).toHaveLength(1);
  });

  it('toggles and closes the drawer flag', () => {
    mount();
    expect(latest?.openDrawer).toBe(false);
    act(() => latest?.onToggleDrawer());
    expect(latest?.openDrawer).toBe(true);
    act(() => latest?.onCloseDrawer());
    expect(latest?.openDrawer).toBe(false);
  });

  it('feeds the persisted preset into ThemeProvider while a bare ThemeProvider stays coral', () => {
    let bare: Theme | undefined;
    let wrapped: Theme | undefined;

    act(() => {
      root.render(
        <StrictMode>
          <ThemeProvider>
            <ThemeProbe onTheme={(theme) => (bare = theme)} />
          </ThemeProvider>
          <SettingsProvider initialState={PRESET2}>
            <ThemeProvider>
              <ThemeProbe onTheme={(theme) => (wrapped = theme)} />
            </ThemeProvider>
          </SettingsProvider>
        </StrictMode>,
      );
    });

    expect(bare?.colorSchemes.light?.palette.primary.main).toBe('#FC7E5B');
    expect(bare?.colorSchemes.light?.palette.text.accent).toBe('#7A2714');
    expect(wrapped?.colorSchemes.light?.palette.primary.main).toBe('#7635dc');
    expect(wrapped?.colorSchemes.dark?.palette.primary.main).toBe('#7635dc');
    expect(wrapped?.colorSchemes.light?.palette.text.accent).toBe('#200A69');
    expect(wrapped?.colorSchemes.dark?.palette.text.accent).toBe('#B985F4');
  });
});

describe('useSettingsContext', () => {
  it('throws outside a SettingsProvider', () => {
    function Consumer() {
      useSettingsContext();
      return null;
    }
    expect(() => renderToStaticMarkup(<Consumer />)).toThrow(
      'useSettingsContext must be used inside SettingsProvider',
    );
  });
});
