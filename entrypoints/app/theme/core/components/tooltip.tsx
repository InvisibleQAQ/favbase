import type { Theme, Components } from '@mui/material/styles';

import { parseCssVar } from 'minimal-shared/utils';

// Minimal bubble colors (grey 800 / dark grey 700) at a 6px radius.
// favbase override: tooltips keep their arrow and the 400ms enter delay —
// compact nav icons rely on the tooltip as their readable name — so Minimal's
// arrowless `-4px` popper offset is not applied.
const MuiTooltip: Components<Theme>['MuiTooltip'] = {
  defaultProps: { arrow: true, enterDelay: 400 },
  styleOverrides: {
    tooltip: ({ theme }) => ({
      borderRadius: Number(theme.shape.borderRadius) * 0.75,
      [parseCssVar(theme.vars.palette.Tooltip.bg)]: theme.vars.palette.grey[800],
      ...theme.applyStyles('dark', {
        [parseCssVar(theme.vars.palette.Tooltip.bg)]: theme.vars.palette.grey[700],
      }),
    }),
  },
};

export const tooltip: Components<Theme> = {
  MuiTooltip,
};
