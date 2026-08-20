import type { PaletteColor, ColorSystemOptions, PaletteColorChannel } from '@mui/material/styles';

import { varAlpha, createPaletteChannel } from 'minimal-shared/utils';

import { themeConfig } from '../theme-config';

import type { ThemeColorScheme } from '../types';

export type PaletteColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
export type PaletteColorNoChannels = Omit<PaletteColor, 'lighterChannel' | 'darkerChannel'>;
export type PaletteColorWithChannels = PaletteColor & PaletteColorChannel;

export type CommonColorsExtend = {
  whiteChannel: string;
  blackChannel: string;
};

export type TypeTextExtend = {
  disabledChannel: string;
  /**
   * The one shade of the brand hue allowed as text (links, emphasis, outlined /
   * text buttons). Scheme-aware: light `primary.darker`, dark `primary.light`.
   * Never use `primary.main` as a text color.
   */
  accent: string;
  accentChannel: string;
};

export type TypeBackgroundExtend = {
  neutral: string;
  neutralChannel: string;
};

export type PaletteColorExtend = {
  lighter: string;
  darker: string;
  lighterChannel: string;
  darkerChannel: string;
};

export type GreyExtend = {
  '50Channel': string;
  '100Channel': string;
  '200Channel': string;
  '300Channel': string;
  '400Channel': string;
  '500Channel': string;
  '600Channel': string;
  '700Channel': string;
  '800Channel': string;
  '900Channel': string;
};

export const primary = createPaletteChannel(themeConfig.palette.primary);
/** Dark scheme keeps the brand hue; only the `lighter` wash is re-inked. */
export const primaryDark = createPaletteChannel({
  ...themeConfig.palette.primary,
  lighter: themeConfig.scheme.dark.primaryLighter,
});
export const secondary = createPaletteChannel(themeConfig.palette.secondary);
export const info = createPaletteChannel(themeConfig.palette.info);
export const success = createPaletteChannel(themeConfig.palette.success);
export const warning = createPaletteChannel(themeConfig.palette.warning);
export const error = createPaletteChannel(themeConfig.palette.error);
export const common = createPaletteChannel(themeConfig.palette.common);
export const grey = createPaletteChannel(themeConfig.palette.grey);

export const text = {
  light: createPaletteChannel({
    primary: '#1F1B17',
    secondary: grey[600],
    // Disabled controls only — never card dates or captions.
    disabled: grey[500],
    accent: themeConfig.scheme.light.accentText,
  }),
  dark: createPaletteChannel({
    primary: '#F3EEE7',
    secondary: '#A89F94',
    disabled: '#7A7168',
    accent: themeConfig.scheme.dark.accentText,
  }),
};

export const background = {
  light: createPaletteChannel({
    paper: '#FFFFFF',
    default: '#F8F4EE',
    neutral: '#F1ECE4',
  }),
  dark: createPaletteChannel({
    paper: '#221E1B',
    default: '#1A1715',
    neutral: '#2A2521',
  }),
};

export const baseAction = {
  hover: varAlpha(grey['500Channel'], 0.08),
  selected: varAlpha(grey['500Channel'], 0.16),
  focus: varAlpha(grey['500Channel'], 0.24),
  disabled: varAlpha(grey['500Channel'], 0.8),
  disabledBackground: varAlpha(grey['500Channel'], 0.24),
  hoverOpacity: 0.08,
  disabledOpacity: 0.48,
};

export const action = {
  light: { ...baseAction, active: grey[600] },
  dark: { ...baseAction, active: grey[500] },
};

export const basePalette = {
  secondary,
  info,
  success,
  warning,
  error,
  common,
  grey,
  // The hairline is the only elevation a surface declares.
  divider: varAlpha(grey['500Channel'], 0.24),
};

export const palette: Partial<Record<ThemeColorScheme, ColorSystemOptions['palette']>> = {
  light: {
    ...basePalette,
    primary,
    text: text.light,
    background: background.light,
    action: action.light,
  },
  dark: {
    ...basePalette,
    primary: primaryDark,
    text: text.dark,
    background: background.dark,
    action: action.dark,
  },
};
