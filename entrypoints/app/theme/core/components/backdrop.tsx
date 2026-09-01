import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

const MuiBackdrop: Components<Theme>['MuiBackdrop'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      variants: [
        {
          props: (props) => !props.invisible,
          style: {
            backgroundColor: varAlpha(theme.vars.palette.grey['800Channel'], 0.48),
          },
        },
      ],
    }),
  },
};

export const backdrop: Components<Theme> = {
  MuiBackdrop,
};
