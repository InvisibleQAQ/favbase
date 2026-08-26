import type { PaletteColor, ColorSystemOptions, PaletteColorChannel } from '@mui/material/styles';

import { varAlpha, createPaletteChannel } from 'minimal-shared/utils';

import type { CollectionPlatform } from '@/lib/collections/platforms';

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

/**
 * One identity color per Collection platform (`theme.vars.palette.platform[platform]`).
 * Allowed ONLY on a platform's icon glyph and its own data graphic; never text,
 * background, or selection (coral is the only selection color). Adding a platform
 * to `COLLECTION_PLATFORMS` fails compilation here until it is mapped.
 */
export type PlatformPalette = Record<CollectionPlatform, string>;
export type PlatformPaletteChannel = Record<`${CollectionPlatform}Channel`, string>;

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
    default: '#FFFFFF',
    neutral: '#F1ECE4',
  }),
  dark: createPaletteChannel({
    paper: '#221E1B',
    default: '#141A21',
    neutral: '#2A2521',
  }),
};

// Six keys written out explicitly (no spread) so the platform completeness
// contract can read every property from the AST. Black-logo brands (github, x)
// are the scheme's ink; the hued four come from `themeConfig.platform`.
const PLATFORM_PALETTE_LIGHT = {
  bilibili: themeConfig.platform.light.bilibili,
  github: text.light.primary,
  bookmarks: themeConfig.platform.light.bookmarks,
  x: text.light.primary,
  zhihu: themeConfig.platform.light.zhihu,
  youtube: themeConfig.platform.light.youtube,
} satisfies PlatformPalette;

const PLATFORM_PALETTE_DARK = {
  bilibili: themeConfig.platform.dark.bilibili,
  github: text.dark.primary,
  bookmarks: themeConfig.platform.dark.bookmarks,
  x: text.dark.primary,
  zhihu: themeConfig.platform.dark.zhihu,
  youtube: themeConfig.platform.dark.youtube,
} satisfies PlatformPalette;

export const platform = {
  light: createPaletteChannel(PLATFORM_PALETTE_LIGHT),
  dark: createPaletteChannel(PLATFORM_PALETTE_DARK),
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
    platform: platform.light,
  },
  dark: {
    ...basePalette,
    primary: primaryDark,
    text: text.dark,
    background: background.dark,
    action: action.dark,
    platform: platform.dark,
  },
};
