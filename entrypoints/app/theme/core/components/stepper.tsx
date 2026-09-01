import type { Theme, Components } from '@mui/material/styles';

import { parseCssVar } from 'minimal-shared/utils';

const MuiStepConnector: Components<Theme>['MuiStepConnector'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      [parseCssVar(theme.vars.palette.StepConnector.border)]: theme.vars.palette.divider,
    }),
  },
};

const MuiStepContent: Components<Theme>['MuiStepContent'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      [parseCssVar(theme.vars.palette.StepContent.border)]: theme.vars.palette.divider,
    }),
  },
};

export const stepper: Components<Theme> = {
  MuiStepConnector,
  MuiStepContent,
};
