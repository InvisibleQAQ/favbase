import type { Theme } from '@mui/material/styles';

/**
 * Desktop sidebar widths (docs/23 §7.6, Minimal v7 `--layout-nav-vertical-width`
 * / `--layout-nav-mini-width`). Favbase toggles one variable between the two
 * because pin/unpin is the only desktop nav mode; `sections/chat` consumes the
 * same variable to offset its history drawer, so the name is part of the contract.
 */
export const NAV_VERTICAL_WIDTH = { pinned: '300px', compact: '88px' } as const;

export function dashboardLayoutVars(theme: Theme, pinned = true) {
  return {
    '--layout-transition-easing': 'linear',
    '--layout-transition-duration': '120ms',
    '--layout-nav-vertical-width': pinned ? NAV_VERTICAL_WIDTH.pinned : NAV_VERTICAL_WIDTH.compact,
    // Nav row geometry consumed by dashboard/nav.tsx: expanded row, platform
    // child row, and the square icon-only target used when compact.
    '--layout-nav-item-height': '44px',
    '--layout-nav-child-item-height': '40px',
    '--layout-nav-compact-item-size': '44px',
    '--layout-dashboard-content-pt': theme.spacing(1),
    '--layout-dashboard-content-pb': theme.spacing(8),
    '--layout-dashboard-content-px': theme.spacing(5),
  };
}
