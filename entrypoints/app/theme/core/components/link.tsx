import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

const MuiLink: Components<Theme>['MuiLink'] = {
  defaultProps: {
    underline: 'hover',
  },
  styleOverrides: {
    root: ({ theme }) => ({
      // favbase override: links read in the brand text shade, never `primary.main`.
      color: theme.vars.palette.text.accent,
      '--Link-underlineColor': varAlpha('currentColor', 0.4),
    }),
  },
};

export const link: Components<Theme> = {
  MuiLink,
};
