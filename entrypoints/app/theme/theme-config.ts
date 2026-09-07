import type { CommonColors } from '@mui/material/styles';

import type { ThemeCssVariables } from './types';
import type { PaletteColorNoChannels } from './core/palette';

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
   * Scheme-owned semantic values: text and background roles describe each
   * ground explicitly. The scheme owns no brand shades — the selection wash is
   * `varAlpha(primary.mainChannel, 0.08 / 0.16)` at the call site and the
   * text-safe `text.accent` is derived from the active primary preset in
   * `core/palette.ts` (`accentTextFor`). Shared primitive ramps stay under
   * `palette`.
   */
  scheme: Record<
    'light' | 'dark',
    {
      text: Record<'primary' | 'secondary' | 'disabled', string>;
      background: Record<'default' | 'paper' | 'neutral', string>;
    }
  >;
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
      text: { primary: '#1C252E', secondary: '#637381', disabled: '#919EAB' },
      background: { default: '#FFFFFF', paper: '#FFFFFF', neutral: '#F4F6F8' },
    },
    dark: {
      // Minimal dark ink: white / grey 500 / grey 600 (docs/25 D12).
      text: { primary: '#FFFFFF', secondary: '#919EAB', disabled: '#637381' },
      // Quieter than Minimal's `#28323D`: youtube dark `#D94040` reads 2.95:1 on
      // that tile (docs/25 C-2), so the neutral stays where every platform
      // graphic holds 3:1. `palette.test.ts` locks the ratio.
      background: { default: '#141A21', paper: '#1C252E', neutral: '#222B34' },
    },
  },
  cssVariables: {
    cssVarPrefix: '',
    colorSchemeSelector: 'data-color-scheme',
  },
};
