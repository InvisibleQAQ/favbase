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
   * Scheme-owned semantic values. The brand hue is fixed; the wash and
   * text-safe accent flip with the scheme, while text/background roles describe
   * each ground explicitly. Shared primitive ramps stay under `palette`.
   */
  scheme: Record<
    'light' | 'dark',
    {
      /** `primary.lighter` — hover / active wash behind ink text. */
      primaryLighter: string;
      /** `text.accent` — the only shade of the brand hue allowed as text. */
      accentText: string;
      text: Record<'primary' | 'secondary' | 'disabled', string>;
      background: Record<'default' | 'paper' | 'neutral', string>;
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
 * Minimal's operational dashboard neutrals with Favbase's coral identity.
 * Coral `#FC7E5B` is a stamp (a block of color) and never small text.
 * Binding: coral hue, DM Sans Variable + Barlow, fox logo, lowercase
 * `favbase` (PRODUCT.md).
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
    // Minimal v7 neutral ramp. Scheme surfaces below reference this ramp.
    grey: {
      '50': '#FCFDFD',
      '100': '#F9FAFB',
      '200': '#F4F6F8',
      '300': '#DFE3E8',
      '400': '#C4CDD5',
      '500': '#919EAB',
      '600': '#637381',
      '700': '#454F5B',
      '800': '#1C252E',
      '900': '#141A21',
    },
    common: { black: '#000000', white: '#FFFFFF' },
  },
  scheme: {
    light: {
      primaryLighter: '#FEE9E1',
      accentText: '#7A2714',
      text: { primary: '#1C252E', secondary: '#637381', disabled: '#919EAB' },
      background: { default: '#FFFFFF', paper: '#FFFFFF', neutral: '#F4F6F8' },
    },
    dark: {
      primaryLighter: '#3A2A24',
      accentText: '#FDA48A',
      text: { primary: '#F4F6F8', secondary: '#C4CDD5', disabled: '#637381' },
      // Slightly quieter than Minimal's neutral so every platform graphic keeps 3:1.
      background: { default: '#141A21', paper: '#1C252E', neutral: '#222B34' },
    },
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
