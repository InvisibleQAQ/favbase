import { createPaletteChannel } from 'minimal-shared/utils';

import type { ThemeSettings } from '@/lib/storage';

import { primaryColorPresets } from './color-presets';
import { grey, createTextPalette } from '../core/palette';
import { createShadowColor } from '../core/custom-shadows';

import type { CustomShadows } from '../core/custom-shadows';
import type { ThemeOptions, ThemeColorScheme, ColorSchemeOptionsExtended } from '../types';

/**
 * Minimal `applySettingsToTheme` reduced to what Favbase persists: the
 * primary preset and the contrast option (`compactLayout` is a layout concern,
 * docs/25 Step 4). No `direction`, no `fontFamily`.
 *
 * favbase overrides:
 * - the preset is applied unconditionally to both schemes (`default` is coral,
 *   so there is no `isDefault` branch) and `text.accent` follows it through
 *   `createTextPalette`;
 * - high contrast also swaps the card shadow token for `z1`. Minimal does that
 *   with a `MuiCssBaseline` body rule in `update-components.ts`; Favbase owns a
 *   `MuiCssBaseline` function override that `createTheme` would replace rather
 *   than merge, and `card.tsx` reads `var(--card-shadow, customShadows.card)`
 *   with no other setter, so the token is the equivalent hook.
 *
 * Pure: the input theme is never mutated.
 */
export function applySettingsToTheme(
  theme: ThemeOptions,
  settingsState: ThemeSettings,
): ThemeOptions {
  const { contrast, primaryColor } = settingsState;
  const isHighContrast = contrast === 'high';

  const preset = primaryColorPresets[primaryColor];
  const primary = createPaletteChannel(preset);

  const updateColorScheme = (schemeName: ThemeColorScheme): ColorSchemeOptionsExtended => {
    const currentScheme: ColorSchemeOptionsExtended = theme.colorSchemes?.[schemeName] ?? {};

    const updatedPalette = {
      ...currentScheme.palette,
      primary,
      text: createTextPalette(schemeName, preset),
      ...(schemeName === 'light' &&
        isHighContrast && {
          background: {
            ...currentScheme.palette?.background,
            default: grey[200],
            defaultChannel: grey['200Channel'],
          },
        }),
    };

    const updatedCustomShadows: Partial<CustomShadows> = {
      ...currentScheme.customShadows,
      primary: createShadowColor(primary.mainChannel),
    };
    if (isHighContrast && currentScheme.customShadows?.z1) {
      updatedCustomShadows.card = currentScheme.customShadows.z1;
    }

    return {
      ...currentScheme,
      palette: updatedPalette,
      customShadows: updatedCustomShadows,
    };
  };

  return {
    ...theme,
    colorSchemes: {
      light: updateColorScheme('light'),
      dark: updateColorScheme('dark'),
    },
  };
}
