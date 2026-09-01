import type {} from '@mui/material/themeCssVarsAugmentation';

import type { DeepPartial } from './types';
import type { MixinsExtend } from './core/mixins';
import type { OpacityExtend } from './core/opacity';
import type { FontStyleExtend } from './core/typography';
import type { CustomShadows } from './core/custom-shadows';
import type { RatingExtendSize } from './core/components/rating';
import type { SliderExtendColor } from './core/components/slider';
import type { BadgeExtendVariant } from './core/components/badge';
import type { TabsExtendIndicatorColor } from './core/components/tabs';
import type { IconButtonExtendColor } from './core/components/button-icon';
import type { ChipExtendColor, ChipExtendVariant } from './core/components/chip';
import type { FabExtendColor, FabExtendVariant } from './core/components/button-fab';
import type { AvatarExtendColor, AvatarGroupExtendVariant } from './core/components/avatar';
import type { PaginationExtendColor, PaginationExtendVariant } from './core/components/pagination';
import type {
  ButtonGroupExtendColor,
  ButtonGroupExtendVariant,
} from './core/components/button-group';
import type {
  ButtonExtendSize,
  ButtonExtendColor,
  ButtonExtendVariant,
} from './core/components/button';
import type {
  GreyExtend,
  PaletteExtend,
  TypeTextExtend,
  PlatformPalette,
  CommonColorsExtend,
  PaletteColorExtend,
  TypeBackgroundExtend,
  PlatformPaletteChannel,
} from './core/palette';

// ➤ Core (palette, typography, mixins, opacity, custom shadows)
declare module '@mui/material/styles' {
  interface PaletteColor extends PaletteColorExtend {}
  interface SimplePaletteColorOptions extends Partial<PaletteColorExtend> {}

  interface Color extends GreyExtend {}
  interface TypeText extends TypeTextExtend {}
  interface CommonColors extends CommonColorsExtend {}
  interface TypeBackground extends TypeBackgroundExtend {}

  /** Minimal `shared` hairlines + the Favbase per-platform identity color. */
  interface Palette extends PaletteExtend {
    platform: PlatformPalette & PlatformPaletteChannel;
  }
  interface PaletteOptions extends DeepPartial<PaletteExtend> {
    platform?: Partial<PlatformPalette & PlatformPaletteChannel>;
  }

  interface TypographyVariants extends FontStyleExtend {}
  interface TypographyVariantsOptions extends Partial<FontStyleExtend> {}

  interface Mixins extends MixinsExtend {}
  interface MixinsOptions extends Partial<MixinsExtend> {}

  interface Opacity extends OpacityExtend {}

  interface Theme {
    customShadows: CustomShadows;
  }
  interface ThemeOptions {
    customShadows?: Partial<CustomShadows>;
  }
  interface ThemeVars {
    customShadows: CustomShadows;
    typography: Theme['typography'];
    transitions: Theme['transitions'];
  }
}

// ➤ Components
declare module '@mui/material/Avatar' {
  interface AvatarOwnProps extends AvatarExtendColor {}
}
declare module '@mui/material/AvatarGroup' {
  interface AvatarGroupPropsVariantOverrides extends AvatarGroupExtendVariant {}
}

declare module '@mui/material/Badge' {
  interface BadgePropsVariantOverrides extends BadgeExtendVariant {}
}

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides extends ButtonExtendVariant {}
  interface ButtonPropsColorOverrides extends ButtonExtendColor {}
  interface ButtonPropsSizeOverrides extends ButtonExtendSize {}
}

declare module '@mui/material/IconButton' {
  interface IconButtonPropsColorOverrides extends IconButtonExtendColor {}
}

declare module '@mui/material/ButtonGroup' {
  interface ButtonGroupPropsVariantOverrides extends ButtonGroupExtendVariant {}
  interface ButtonGroupPropsColorOverrides extends ButtonGroupExtendColor {}
}

declare module '@mui/material/Fab' {
  interface FabPropsVariantOverrides extends FabExtendVariant {}
  interface FabPropsColorOverrides extends FabExtendColor {}
}

declare module '@mui/material/Chip' {
  interface ChipPropsVariantOverrides extends ChipExtendVariant {}
  interface ChipPropsColorOverrides extends ChipExtendColor {}
}

declare module '@mui/material/Pagination' {
  interface PaginationPropsVariantOverrides extends PaginationExtendVariant {}
  interface PaginationPropsColorOverrides extends PaginationExtendColor {}
}
declare module '@mui/material/PaginationItem' {
  interface PaginationItemPropsVariantOverrides extends PaginationExtendVariant {}
  interface PaginationItemPropsColorOverrides extends PaginationExtendColor {}
}

declare module '@mui/material/Slider' {
  interface SliderPropsColorOverrides extends SliderExtendColor {}
}

declare module '@mui/material/Rating' {
  interface RatingPropsSizeOverrides extends RatingExtendSize {}
}

declare module '@mui/material/Tabs' {
  interface TabsPropsIndicatorColorOverrides extends TabsExtendIndicatorColor {}
}
