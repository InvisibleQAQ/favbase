import { describe, expect, it } from 'vitest';

import { createTheme } from '../../theme/create-theme';
import { layoutSectionVars } from '../core/css-vars';
import { dashboardLayoutVars } from './css-vars';

// Shell geometry contract. `sections/chat`, `NavToggleButton` and every
// DashboardContent consumer read these names; a rename or drift here is a
// layout regression, not a style tweak. Nav row heights are no longer here —
// they moved to `components/nav-section/css-vars.test.ts` with the ported nav
// (docs/25 Step 4).
const theme = createTheme();

describe('layout shell CSS variables', () => {
  it('keeps the Minimal v7 header and mobile drawer geometry', () => {
    expect(layoutSectionVars(theme)).toMatchObject({
      '--layout-header-mobile-height': '64px',
      '--layout-header-desktop-height': '72px',
      '--layout-header-blur': '8px',
      '--layout-nav-mobile-width': '288px',
    });
  });

  it('switches the desktop sidebar between 300px vertical and 88px mini', () => {
    expect(dashboardLayoutVars(theme, true)['--layout-nav-vertical-width']).toBe('300px');
    expect(dashboardLayoutVars(theme, false)['--layout-nav-vertical-width']).toBe('88px');
  });

  it('locks content gutters and the 120ms layout transition', () => {
    // 1 / 8 / 5 spacing units = 8 / 64 / 40px on the 8px base.
    expect(theme.spacing(1)).toContain('8px');
    expect(dashboardLayoutVars(theme)).toMatchObject({
      '--layout-dashboard-content-pt': theme.spacing(1),
      '--layout-dashboard-content-pb': theme.spacing(8),
      '--layout-dashboard-content-px': theme.spacing(5),
      '--layout-transition-duration': '120ms',
    });
    // Owned by the nav now; the shell must not resurrect them.
    expect(dashboardLayoutVars(theme)).not.toHaveProperty('--layout-nav-item-height');
  });
});
