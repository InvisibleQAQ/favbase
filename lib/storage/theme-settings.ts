import { storage } from 'wxt/utils/storage';
import { z } from 'zod';
import { STORAGE_KEYS } from './keys';

/**
 * app.html theme settings (docs/25 Step 2, D13): the primary-color preset,
 * the contrast option and the compact-layout flag chosen in the settings
 * drawer. Light/dark mode is deliberately NOT part of this record — MUI's
 * `ThemeProvider` owns it under the `favbase-color-mode` localStorage key so
 * `public/theme-init.js` can apply it before React mounts.
 *
 * The preset ids are the single source for `theme/with-settings/color-presets.ts`
 * (`Record<ThemeColorPreset, …>` fails compilation when one is missing); lib
 * cannot import `entrypoints/`, so they live here.
 */

export const THEME_COLOR_PRESETS = [
  'default',
  'preset1',
  'preset2',
  'preset3',
  'preset4',
  'preset5',
] as const;
export type ThemeColorPreset = (typeof THEME_COLOR_PRESETS)[number];

export const THEME_CONTRASTS = ['default', 'high'] as const;
export type ThemeContrast = (typeof THEME_CONTRASTS)[number];

export interface ThemeSettings {
  primaryColor: ThemeColorPreset;
  contrast: ThemeContrast;
  compactLayout: boolean;
}

// No `version` field in the value: WXT `defineItem` carries `version` +
// `migrations` natively (an unversioned item is implicitly v1), and invalid
// fields fall back one by one below instead of resetting the whole record.
export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = Object.freeze({
  primaryColor: 'default',
  contrast: 'default',
  compactLayout: false,
});

// Persisted values are untrusted input: each field independently falls back
// to its default, so a preset removed in a later release cannot take the
// contrast or layout choice down with it.
const themeSettingsSchema = z.object({
  primaryColor: z.enum(THEME_COLOR_PRESETS).catch(DEFAULT_THEME_SETTINGS.primaryColor),
  contrast: z.enum(THEME_CONTRASTS).catch(DEFAULT_THEME_SETTINGS.contrast),
  compactLayout: z.boolean().catch(DEFAULT_THEME_SETTINGS.compactLayout),
});

/** Never throws: a non-object becomes the defaults, invalid fields fall back individually. */
export function canonicalizeThemeSettings(value: unknown): ThemeSettings {
  const parsed = themeSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_THEME_SETTINGS };
}

export const themeSettingsStorage = storage.defineItem<ThemeSettings>(
  STORAGE_KEYS.themeSettings,
  { fallback: DEFAULT_THEME_SETTINGS },
);

export function getThemeSettings(): Promise<ThemeSettings> {
  return themeSettingsStorage.getValue().then(canonicalizeThemeSettings);
}

export function setThemeSettings(settings: ThemeSettings): Promise<void> {
  return themeSettingsStorage.setValue(settings);
}

export function watchThemeSettings(
  callback: (settings: ThemeSettings) => void,
): () => void {
  return themeSettingsStorage.watch((value) => callback(canonicalizeThemeSettings(value)));
}

export function isSameThemeSettings(a: ThemeSettings, b: ThemeSettings): boolean {
  return (
    a.primaryColor === b.primaryColor &&
    a.contrast === b.contrast &&
    a.compactLayout === b.compactLayout
  );
}
