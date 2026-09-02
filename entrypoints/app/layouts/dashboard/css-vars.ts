import type { Theme } from '@mui/material/styles';

/**
 * Desktop sidebar widths (Minimal v7 `--layout-nav-vertical-width` /
 * `--layout-nav-mini-width`). Favbase toggles one variable between the two
 * because pin/unpin is the only desktop nav mode, and `sections/chat` plus
 * `NavToggleButton` read that variable to place themselves against the rail —
 * so the name and its toggling semantics are part of the contract.
 *
 * Nav row geometry is NOT here: it moved to
 * `components/nav-section/styles/css-vars.ts` with the ported nav (docs/25
 * Step 4). This file owns the shell — rail width, content gutters, transition.
 */
export const NAV_VERTICAL_WIDTH = { vertical: '300px', mini: '88px' } as const;

export function dashboardLayoutVars(theme: Theme, pinned = true) {
  return {
    '--layout-transition-easing': 'linear',
    '--layout-transition-duration': '120ms',
    '--layout-nav-vertical-width': pinned
      ? NAV_VERTICAL_WIDTH.vertical
      : NAV_VERTICAL_WIDTH.mini,
    '--layout-dashboard-content-pt': theme.spacing(1),
    '--layout-dashboard-content-pb': theme.spacing(8),
    '--layout-dashboard-content-px': theme.spacing(5),
  };
}
