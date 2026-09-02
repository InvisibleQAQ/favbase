import type { ReactNode, ComponentProps } from 'react';

import type { LabelRoot } from './styles';
import type { PaletteColorKey, CommonColorsKeys } from '../../theme/core/palette';

export type LabelColor = PaletteColorKey | CommonColorsKeys | 'default';

export type LabelVariant = 'filled' | 'outlined' | 'soft' | 'inverted';

export interface LabelProps extends ComponentProps<typeof LabelRoot> {
  disabled?: boolean;
  color?: LabelColor;
  variant?: LabelVariant;
  endIcon?: ReactNode;
  startIcon?: ReactNode;
}
