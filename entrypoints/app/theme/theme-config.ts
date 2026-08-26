import type { CommonColors } from '@mui/material/styles';

import type { CollectionPlatform } from '@/lib/collections/platforms';

import type { ThemeCssVariables } from './types';
import type { PaletteColorNoChannels } from './core/palette';

/**
 * Platforms whose logo has a hue. GitHub and X are black-logo brands and stay
 * ink (`text.primary`) — see `core/palette.ts`, which maps all six keys.
 */
export type BrandColoredPlatform = Exclude<CollectionPlatform, 'github' | 'x'>;

type ThemeConfig = {
  classesPrefix: string;
  cssVariables: ThemeCssVariables;
  fontFamily: Record<'primary' | 'secondary', string>;
  palette: Record<
    'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error',
    PaletteColorNoChannels
  > & {
    common: Pick<CommonColors, 'black' | 'white'>;
    grey: Record<
      '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900',
      string
    >;
  };
  /**
   * Scheme-split brand values. The brand hue is fixed; only the wash (`lighter`,
   * used for hover/active tints) and the text-safe accent flip with the scheme.
   * Everything else in `palette` is shared by light and dark.
   */
  scheme: Record<
    'light' | 'dark',
    {
      /** `primary.lighter` — hover / active wash behind ink text. */
      primaryLighter: string;
      /** `text.accent` — the only shade of the brand hue allowed as text. */
      accentText: string;
    }
  >;
  /**
   * Platform identity colors, consumed as `theme.vars.palette.platform[platform]`.
   * They land ONLY on a platform's icon glyph and its own data graphic (share bar);
   * never text, never a background, never a selection state (coral owns selection).
   */
  platform: Record<'light' | 'dark', Record<BrandColoredPlatform, string>>;
};

/**
 * Catalog-card visual language (docs/19 §7.0.1). White canvas, warm ink
 * text, warm grey hairlines; coral `#FC7E5B` is a stamp (a block of color)
 * and never small text. Binding: coral hue, DM Sans Variable + Barlow,
 * fox logo, lowercase `favbase` (PRODUCT.md).
 */
export const themeConfig: ThemeConfig = {
  classesPrefix: 'favbase',
  fontFamily: {
    primary: 'DM Sans Variable',
    secondary: 'Barlow',
  },
  palette: {
    primary: {
      lighter: '#FEE9E1',
      light: '#FDA48A',
      main: '#FC7E5B',
      dark: '#C4502E',
      darker: '#7A2714',
      // Ink on coral (≈6.7:1) — the stamp is read, never squinted at.
      contrastText: '#1F1B17',
    },
    secondary: {
      lighter: '#EFD6FF',
      light: '#C684FF',
      main: '#8E33FF',
      dark: '#5119B7',
      darker: '#27097A',
      contrastText: '#FFFFFF',
    },
    info: {
      lighter: '#CAFDF5',
      light: '#61F3F3',
      main: '#00B8D9',
      dark: '#006C9C',
      darker: '#003768',
      contrastText: '#FFFFFF',
    },
    success: {
      lighter: '#D3FCD2',
      light: '#77ED8B',
      main: '#22C55E',
      dark: '#118D57',
      darker: '#065E49',
      contrastText: '#FFFFFF',
    },
    warning: {
      lighter: '#FFF5CC',
      light: '#FFD666',
      main: '#FFAB00',
      dark: '#B76E00',
      darker: '#7A4100',
      contrastText: '#1F1B17',
    },
    error: {
      lighter: '#FFE0DE',
      light: '#FF7A75',
      main: '#E53935',
      dark: '#B71C1C',
      darker: '#7A0C0C',
      contrastText: '#FFFFFF',
    },
    // Warm grey ramp: paper at the top, ink at the bottom.
    grey: {
      '50': '#FBF9F6',
      '100': '#F5F1EA',
      '200': '#ECE6DD',
      '300': '#DCD4C8',
      '400': '#BDB3A6',
      '500': '#8F867B',
      '600': '#6B635A',
      '700': '#4A443E',
      '800': '#2A2521',
      '900': '#1A1715',
    },
    common: { black: '#000000', white: '#FFFFFF' },
  },
  scheme: {
    light: { primaryLighter: '#FEE9E1', accentText: '#7A2714' },
    dark: { primaryLighter: '#3A2A24', accentText: '#FDA48A' },
  },
  // Brand hues re-inked for each ground. Values come from the dataviz palette
  // validator (adjacent-pairs mode, all six checks pass on both the ground and
  // the neutral tile of each scheme; raw brand hexes such as bilibili #FB7299
  // fail contrast at 2.4:1). Changing a value REQUIRES re-running the validator
  // and updating `.trellis/tasks/08-20-analytics-platform-brand-colors/research/palette-validation.md`.
  // `core/palette.test.ts` locks every value at >= 3:1 against both surfaces.
  platform: {
    light: { bilibili: '#C2185B', bookmarks: '#B8760A', zhihu: '#1A73E8', youtube: '#C62828' },
    dark: { bilibili: '#E8497F', bookmarks: '#BF8A10', zhihu: '#3B8BEA', youtube: '#D94040' },
  },
  cssVariables: {
    cssVarPrefix: '',
    colorSchemeSelector: 'data-color-scheme',
  },
};
