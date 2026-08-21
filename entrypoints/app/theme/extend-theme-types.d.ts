import type {} from '@mui/material/themeCssVarsAugmentation';

import type { FontStyleExtend } from './core/typography';
import type { CustomShadows } from './core/custom-shadows';
import type {
  GreyExtend,
  TypeTextExtend,
  PlatformPalette,
  CommonColorsExtend,
  PaletteColorExtend,
  TypeBackgroundExtend,
  PlatformPaletteChannel,
} from './core/palette';

declare module '@mui/material/styles' {
  interface Color extends GreyExtend {}
  interface TypeText extends TypeTextExtend {}
  interface CommonColors extends CommonColorsExtend {}
  interface TypeBackground extends TypeBackgroundExtend {}
  interface PaletteColor extends PaletteColorExtend {}
  interface SimplePaletteColorOptions extends Partial<PaletteColorExtend> {}
  /** Per-platform identity color; flows into `theme.vars.palette.platform[platform]`. */
  interface Palette {
    platform: PlatformPalette & PlatformPaletteChannel;
  }
  interface PaletteOptions {
    platform?: Partial<PlatformPalette & PlatformPaletteChannel>;
  }
}

declare module '@mui/material/styles' {
  interface TypographyVariants extends FontStyleExtend {}
  interface TypographyVariantsOptions extends Partial<FontStyleExtend> {}
}

declare module '@mui/material/styles' {
  interface Theme {
    customShadows: CustomShadows;
  }
  interface ThemeOptions {
    customShadows?: CustomShadows;
  }
  interface ThemeVars {
    customShadows: CustomShadows;
    typography: Theme['typography'];
    transitions: Theme['transitions'];
  }
}
