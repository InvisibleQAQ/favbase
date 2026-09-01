import type {
  TypeAction,
  PaletteColor,
  ColorSystemOptions,
  PaletteColorChannel,
} from '@mui/material/styles';

import { varAlpha, createPaletteChannel } from 'minimal-shared/utils';

import type { CollectionPlatform } from '@/lib/collections/platforms';

import { opacity } from './opacity';
import { themeConfig } from '../theme-config';

import type { SchemesRecord } from '../types';

/**
 * Minimal `core/palette.ts` skeleton with the Favbase brand tokens:
 * coral `primary` (dark scheme re-inks only `lighter`), `text.accent`, the
 * six-platform `platform` palette, and scheme text/background values owned by
 * `theme-config.ts`. Type extensions land in `../extend-theme-types.d.ts`.
 */

export type PaletteColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
export type CommonColorsKeys = 'black' | 'white';
export type PaletteColorNoChannels = Omit<PaletteColor, 'lighterChannel' | 'darkerChannel'>;
export type PaletteColorWithChannels = PaletteColor & PaletteColorChannel;

export type PaletteColorExtend = {
  lighter: string;
  darker: string;
  lighterChannel: string;
  darkerChannel: string;
};

export type CommonColorsExtend = {
  whiteChannel: string;
  blackChannel: string;
};

export type TypeTextExtend = {
  disabledChannel: string;
  /**
   * favbase override: the one shade of the brand hue allowed as text (links,
   * emphasis, outlined / text buttons, soft-primary labels). Scheme-aware:
   * light `primary.darker`, dark `primary.light`. Never use `primary.main` as
   * a text color.
   */
  accent: string;
  accentChannel: string;
};

export type TypeBackgroundExtend = {
  neutral: string;
  neutralChannel: string;
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

/** Minimal's shared hairline alphas (`theme.vars.palette.shared.*`). */
export type PaletteExtend = {
  shared: {
    inputOutlined: string;
    inputUnderline: string;
    paperOutlined: string;
    buttonOutlined: string;
  };
};

/**
 * One identity color per Collection platform (`theme.vars.palette.platform[platform]`).
 * Allowed ONLY on a platform's icon glyph and its own data graphic; never text,
 * background, or selection (coral is the only selection color). Adding a platform
 * to `COLLECTION_PLATFORMS` fails compilation here until it is mapped.
 */
export type PlatformPalette = Record<CollectionPlatform, string>;
export type PlatformPaletteChannel = Record<`${CollectionPlatform}Channel`, string>;

// ➤ Core palette (primary, secondary, info, success, warning, error, common, grey)
export const primary = createPaletteChannel(themeConfig.palette.primary);
/** favbase override: dark scheme keeps the brand hue; only the `lighter` wash is re-inked. */
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

// ➤ Text, background, action
export const text = {
  light: createPaletteChannel({
    ...themeConfig.scheme.light.text,
    accent: themeConfig.scheme.light.accentText,
  }),
  dark: createPaletteChannel({
    ...themeConfig.scheme.dark.text,
    accent: themeConfig.scheme.dark.accentText,
  }),
};

export const background = {
  light: createPaletteChannel(themeConfig.scheme.light.background),
  dark: createPaletteChannel(themeConfig.scheme.dark.background),
};

export const action = (mode: 'light' | 'dark'): Partial<TypeAction> => ({
  active: mode === 'light' ? grey[600] : grey[500],
  hover: varAlpha(grey['500Channel'], 0.08),
  selected: varAlpha(grey['500Channel'], 0.16),
  focus: varAlpha(grey['500Channel'], 0.24),
  disabled: varAlpha(grey['500Channel'], 0.8),
  disabledBackground: varAlpha(grey['500Channel'], 0.24),
  hoverOpacity: 0.08,
  selectedOpacity: 0.08,
  focusOpacity: 0.12,
  activatedOpacity: 0.12,
  disabledOpacity: 0.48,
});

// ➤ Platform identity
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

// ➤ Extended palette
export const extendPalette: PaletteExtend = {
  shared: {
    inputUnderline: varAlpha(grey['500Channel'], opacity.inputUnderline),
    inputOutlined: varAlpha(grey['500Channel'], 0.2),
    paperOutlined: varAlpha(grey['500Channel'], 0.16),
    buttonOutlined: varAlpha(grey['500Channel'], 0.32),
  },
};

// ➤ Base configuration
const basePalette: ColorSystemOptions['palette'] = {
  secondary,
  info,
  success,
  warning,
  error,
  common,
  grey,
  divider: varAlpha(grey['500Channel'], 0.2),
  TableCell: { border: varAlpha(grey['500Channel'], 0.2) },
  ...extendPalette,
};

export const palette: SchemesRecord<ColorSystemOptions['palette']> = {
  light: {
    ...basePalette,
    primary,
    text: text.light,
    background: background.light,
    action: action('light'),
    platform: platform.light,
  },
  dark: {
    ...basePalette,
    primary: primaryDark,
    text: text.dark,
    background: background.dark,
    action: action('dark'),
    platform: platform.dark,
  },
};

/** Iteration order for the per-color component variants (Button, Chip, Fab, …). */
export const colorKeys: {
  palette: PaletteColorKey[];
  common: CommonColorsKeys[];
} = {
  palette: ['primary', 'secondary', 'info', 'success', 'warning', 'error'],
  common: ['black', 'white'],
};
