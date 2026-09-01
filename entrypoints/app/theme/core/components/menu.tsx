import type { Theme, Components } from '@mui/material/styles';

const MuiMenuItem: Components<Theme>['MuiMenuItem'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      ...theme.mixins.menuItemStyles(theme),
    }),
  },
};

export const menu: Components<Theme> = {
  MuiMenuItem,
};
