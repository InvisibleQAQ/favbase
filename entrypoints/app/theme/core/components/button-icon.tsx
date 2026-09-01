import type { Theme, Components, ComponentsVariants } from '@mui/material/styles';

import { colorKeys } from '../palette';

export type IconButtonExtendColor = { black: true; white: true };

type IconButtonVariants = ComponentsVariants<Theme>['MuiIconButton'];

// ➤ Variants
const colorVariants = [
  ...(colorKeys.common.map((colorKey) => ({
    props: (props) => props.color === colorKey,
    style: ({ theme }) => ({
      color: theme.vars.palette.common[colorKey],
    }),
  })) satisfies IconButtonVariants),
] satisfies IconButtonVariants;

// ➤ Components
const MuiIconButton: Components<Theme>['MuiIconButton'] = {
  styleOverrides: {
    root: {
      variants: [...colorVariants],
    },
  },
};

export const iconButton: Components<Theme> = {
  MuiIconButton,
};
