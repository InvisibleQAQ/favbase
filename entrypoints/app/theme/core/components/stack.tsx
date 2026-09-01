import type { Theme, Components } from '@mui/material/styles';

const MuiStack: Components<Theme>['MuiStack'] = {
  defaultProps: {
    useFlexGap: true,
  },
};

export const stack: Components<Theme> = {
  MuiStack,
};
