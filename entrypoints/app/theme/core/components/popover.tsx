import type { Theme, Components } from '@mui/material/styles';

import { listClasses } from '@mui/material/List';

// Also the Menu and Select dropdown paper: `paperStyles(dropdown)` gives the
// 4px inset, dropdown shadow and 10px radius; the inner list adds no padding.
const MuiPopover: Components<Theme>['MuiPopover'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      ...theme.mixins.paperStyles(theme, { dropdown: true }),
      [`& .${listClasses.root}`]: {
        paddingTop: 0,
        paddingBottom: 0,
      },
    }),
  },
};

export const popover: Components<Theme> = {
  MuiPopover,
};
