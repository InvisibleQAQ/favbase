import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stub of WXT's storage.defineItem (chrome.storage is absent in
// vitest). Round-trip fidelity + fallback semantics + a watch fan-out so the
// canonicalizing watcher facade can be exercised.
const storageMock = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();
  const notify = (key: string, value: unknown) => {
    for (const watcher of watchers.get(key) ?? []) watcher(value);
  };
  return { store, watchers, notify };
});

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem<T>(key: string, opts?: { fallback?: T }) {
      return {
        async getValue(): Promise<T> {
          return (storageMock.store.has(key) ? storageMock.store.get(key) : opts?.fallback) as T;
        },
        async setValue(value: T): Promise<void> {
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

import { STORAGE_KEYS } from './keys';
import {
  DEFAULT_THEME_SETTINGS,
  THEME_COLOR_PRESETS,
  canonicalizeThemeSettings,
  getThemeSettings,
  isSameThemeSettings,
  setThemeSettings,
  themeSettingsStorage,
  watchThemeSettings,
  type ThemeSettings,
} from './theme-settings';

const PRESET2: ThemeSettings = { primaryColor: 'preset2', contrast: 'high', compactLayout: true };

describe('themeSettingsStorage', () => {
  beforeEach(async () => {
    storageMock.watchers.clear();
    await themeSettingsStorage.removeValue();
  });

  it('falls back to the frozen defaults (coral, default contrast, non-compact)', async () => {
    expect(DEFAULT_THEME_SETTINGS).toEqual({
      primaryColor: 'default',
      contrast: 'default',
      compactLayout: false,
    });
    expect(Object.isFrozen(DEFAULT_THEME_SETTINGS)).toBe(true);
    expect(STORAGE_KEYS.themeSettings).toBe('local:themeSettings');
    expect(await themeSettingsStorage.getValue()).toEqual(DEFAULT_THEME_SETTINGS);
    expect(await getThemeSettings()).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it('lists coral first and the five Minimal presets after it', () => {
    expect(THEME_COLOR_PRESETS).toEqual([
      'default',
      'preset1',
      'preset2',
      'preset3',
      'preset4',
      'preset5',
    ]);
  });

  it('round-trips a full settings record', async () => {
    await setThemeSettings(PRESET2);
    expect(await getThemeSettings()).toEqual(PRESET2);
  });

  it('publishes canonical values to watchers and stops after unwatch', async () => {
    const seen: ThemeSettings[] = [];
    const unwatch = watchThemeSettings((value) => seen.push(value));

    await setThemeSettings(PRESET2);
    // A foreign writer (another context, an older build) can leave junk behind.
    storageMock.notify(STORAGE_KEYS.themeSettings, { primaryColor: 'preset9', compactLayout: 'yes' });
    unwatch();
    await setThemeSettings(DEFAULT_THEME_SETTINGS);

    expect(seen).toEqual([PRESET2, DEFAULT_THEME_SETTINGS]);
  });
});

describe('canonicalizeThemeSettings', () => {
  it('returns a fresh copy of the defaults for non-object input', () => {
    for (const input of [null, undefined, 'preset2', 42, true, []]) {
      const result = canonicalizeThemeSettings(input);
      expect(result).toEqual(DEFAULT_THEME_SETTINGS);
      expect(result).not.toBe(DEFAULT_THEME_SETTINGS);
    }
  });

  it('keeps a valid record as-is and drops unknown keys', () => {
    expect(canonicalizeThemeSettings({ ...PRESET2, version: '1' })).toEqual(PRESET2);
  });

  it('falls back per field: an unknown preset does not reset contrast or layout', () => {
    expect(canonicalizeThemeSettings({ primaryColor: 'preset9', contrast: 'high', compactLayout: true })).toEqual({
      primaryColor: 'default',
      contrast: 'high',
      compactLayout: true,
    });
  });

  it('falls back an invalid contrast value', () => {
    expect(canonicalizeThemeSettings({ primaryColor: 'preset3', contrast: 'medium', compactLayout: false })).toEqual({
      primaryColor: 'preset3',
      contrast: 'default',
      compactLayout: false,
    });
  });

  it('falls back a non-boolean compactLayout', () => {
    expect(canonicalizeThemeSettings({ primaryColor: 'preset1', contrast: 'default', compactLayout: 'true' })).toEqual({
      primaryColor: 'preset1',
      contrast: 'default',
      compactLayout: false,
    });
  });

  it('fills missing fields with their defaults', () => {
    expect(canonicalizeThemeSettings({ primaryColor: 'preset4' })).toEqual({
      primaryColor: 'preset4',
      contrast: 'default',
      compactLayout: false,
    });
  });
});

describe('isSameThemeSettings', () => {
  it('compares the three fields by value', () => {
    expect(isSameThemeSettings(PRESET2, { ...PRESET2 })).toBe(true);
    expect(isSameThemeSettings(PRESET2, { ...PRESET2, compactLayout: false })).toBe(false);
    expect(isSameThemeSettings(PRESET2, { ...PRESET2, contrast: 'default' })).toBe(false);
    expect(isSameThemeSettings(PRESET2, { ...PRESET2, primaryColor: 'preset1' })).toBe(false);
  });
});
