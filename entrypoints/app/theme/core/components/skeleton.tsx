import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

const MuiSkeleton: Components<Theme>['MuiSkeleton'] = {
  defaultProps: {
    animation: 'wave',
    variant: 'rounded',
  },
  styleOverrides: {
    root: ({ theme }) => ({
      backgroundColor: varAlpha(theme.vars.palette.grey['400Channel'], 0.12),
    }),
    rounded: ({ theme }) => ({
      borderRadius: Number(theme.shape.borderRadius) * 2,
    }),
  },
};

export const skeleton: Components<Theme> = {
  MuiSkeleton,
};
