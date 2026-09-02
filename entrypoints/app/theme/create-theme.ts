import type { Theme } from '@mui/material/styles';

import { createTheme as createMuiTheme } from '@mui/material/styles';

import type { ThemeSettings } from '@/lib/storage';

import { mixins } from './core/mixins';
import { opacity } from './core/opacity';
import { shadows } from './core/shadows';
import { palette } from './core/palette';
import { themeConfig } from './theme-config';
import { components } from './core/components';
import { typography } from './core/typography';
import { customShadows } from './core/custom-shadows';
import { applySettingsToTheme } from './with-settings';

import type { ThemeOptions } from './types';

export const baseTheme: ThemeOptions = {
  colorSchemes: {
    light: {
      palette: palette.light,
      shadows: shadows.light,
      customShadows: customShadows.light,
      opacity,
    },
    dark: {
      palette: palette.dark,
      shadows: shadows.dark,
      customShadows: customShadows.dark,
      opacity,
    },
  },
  mixins,
  components,
  typography,
  // One 8px unit. Card/Dialog (×2 = 16), dropdown paper (×1.25 = 10) and
  // compact rows (×0.75 = 6) derive from it inside the theme; pages use
  // fractional units at their call site.
  shape: { borderRadius: 8 },
  cssVariables: themeConfig.cssVariables,
};

type CreateThemeProps = {
  /** Persisted drawer state (preset / contrast). Omitted = coral defaults. */
  settingsState?: ThemeSettings;
  themeOverrides?: ThemeOptions;
};

export function createTheme({ settingsState, themeOverrides = {} }: CreateThemeProps = {}): Theme {
  const updatedCore = settingsState ? applySettingsToTheme(baseTheme, settingsState) : baseTheme;

  return createMuiTheme(updatedCore, themeOverrides);
}
