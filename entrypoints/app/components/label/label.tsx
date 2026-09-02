import type { LabelProps } from './types';

import { mergeClasses } from 'minimal-shared/utils';

import { labelClasses } from './classes';
import { LabelRoot, LabelIcon } from './styles';

/**
 * Status pill. Children render verbatim — unlike Minimal we do not upper-case
 * the first letter, because every string that reaches this component already
 * came out of `t()` with the casing its locale wants.
 */
export function Label({
  sx,
  endIcon,
  children,
  startIcon,
  className,
  disabled,
  variant = 'soft',
  color = 'default',
  ...other
}: LabelProps) {
  return (
    <LabelRoot
      color={color}
      variant={variant}
      disabled={disabled}
      className={mergeClasses([labelClasses.root, className])}
      sx={sx}
      {...other}
    >
      {startIcon && <LabelIcon className={labelClasses.icon}>{startIcon}</LabelIcon>}

      {children}

      {endIcon && <LabelIcon className={labelClasses.icon}>{endIcon}</LabelIcon>}
    </LabelRoot>
  );
}
