import { describe, expect, it } from 'vitest';

import type { ThemeSettings } from '@/lib/storage';

import { baseTheme } from '../create-theme';
import { themeConfig } from '../theme-config';
import { applySettingsToTheme } from './update-core';

import type { ThemeOptions, ThemeColorScheme } from '../types';
import type { PaletteColorWithChannels } from '../core/palette';

// Inline literals (not `DEFAULT_THEME_SETTINGS`) keep this test free of the
// storage module's load-time `defineItem`.
const DEFAULT: ThemeSettings = { primaryColor: 'default', contrast: 'default', compactLayout: false };
const PRESET2: ThemeSettings = { ...DEFAULT, primaryColor: 'preset2' };
const HIGH_CONTRAST: ThemeSettings = { ...DEFAULT, contrast: 'high' };

function scheme(theme: ThemeOptions, name: ThemeColorScheme) {
  const options = theme.colorSchemes?.[name];
  if (!options?.palette || !options.customShadows) throw new Error(`missing ${name} scheme`);
  return {
    palette: options.palette,
    primary: options.palette.primary as PaletteColorWithChannels,
    customShadows: options.customShadows,
  };
}

describe('applySettingsToTheme', () => {
  it('leaves the default preset on the base coral ramp and text roles', () => {
    const updated = applySettingsToTheme(baseTheme, DEFAULT);
    for (const name of ['light', 'dark'] as const) {
      expect(scheme(updated, name).palette.primary).toEqual(scheme(baseTheme, name).palette.primary);
      expect(scheme(updated, name).palette.text).toEqual(scheme(baseTheme, name).palette.text);
      expect(scheme(updated, name).customShadows).toEqual(scheme(baseTheme, name).customShadows);
    }
  });

  it('swaps the primary ramp, its shadow and text.accent in both schemes for a preset', () => {
    const updated = applySettingsToTheme(baseTheme, PRESET2);

    for (const name of ['light', 'dark'] as const) {
      const { primary, customShadows } = scheme(updated, name);
      expect(primary.main).toBe('#7635dc');
      expect(primary.mainChannel).toBe('118 53 220');
      expect(primary.contrastText).toBe('#FFFFFF');
      expect(customShadows.primary).toContain('118 53 220');
    }

    // light accent = preset `darker`, dark accent = preset `light`.
    expect(scheme(updated, 'light').palette.text).toMatchObject({ accent: '#200A69', accentChannel: '32 10 105' });
    expect(scheme(updated, 'dark').palette.text).toMatchObject({ accent: '#B985F4', accentChannel: '185 133 244' });
    // Scheme text roles themselves are untouched.
    expect(scheme(updated, 'light').palette.text?.primary).toBe(themeConfig.scheme.light.text.primary);
    expect(scheme(updated, 'dark').palette.text?.secondary).toBe(themeConfig.scheme.dark.text.secondary);
  });

  it('high contrast greys the light ground and flattens cards to z1 in both schemes', () => {
    const updated = applySettingsToTheme(baseTheme, HIGH_CONTRAST);

    expect(scheme(updated, 'light').palette.background).toMatchObject({
      default: '#F4F6F8',
      defaultChannel: '244 246 248',
      paper: themeConfig.scheme.light.background.paper,
    });
    expect(scheme(updated, 'dark').palette.background?.default).toBe('#141A21');

    for (const name of ['light', 'dark'] as const) {
      const { customShadows } = scheme(updated, name);
      expect(customShadows.card).toBe(customShadows.z1);
      expect(customShadows.card).not.toBe(scheme(baseTheme, name).customShadows.card);
    }
  });

  it('keeps the base card shadow at default contrast', () => {
    const updated = applySettingsToTheme(baseTheme, PRESET2);
    for (const name of ['light', 'dark'] as const) {
      expect(scheme(updated, name).customShadows.card).toBe(scheme(baseTheme, name).customShadows.card);
    }
  });

  it('does not mutate the base theme', () => {
    const snapshot = JSON.stringify(baseTheme.colorSchemes);
    applySettingsToTheme(baseTheme, { primaryColor: 'preset5', contrast: 'high', compactLayout: true });
    expect(JSON.stringify(baseTheme.colorSchemes)).toBe(snapshot);
    expect(scheme(baseTheme, 'light').primary.main).toBe(themeConfig.palette.primary.main);
    expect(scheme(baseTheme, 'light').palette.background?.default).toBe(themeConfig.scheme.light.background.default);
  });
});
