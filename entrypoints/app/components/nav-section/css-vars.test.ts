import { describe, expect, it } from 'vitest';

import { createTheme } from '../../theme/create-theme';
import { navSectionCssVars } from './styles/css-vars';

// Nav geometry contract (docs/25 Step 4). These three heights used to live in
// `layouts/dashboard/css-vars.ts` as `--layout-nav-*`; the ported nav owns them
// now, and `layouts/dashboard/css-vars.test.ts` no longer asserts them.
const theme = createTheme();

describe('nav-section CSS variables', () => {
  it('locks the Minimal row heights: 44 expanded, 36 nested, 56 mini', () => {
    expect(navSectionCssVars.vertical(theme)).toMatchObject({
      '--nav-item-root-height': '44px',
      '--nav-item-sub-height': '36px',
      '--nav-icon-size': '24px',
    });
    expect(navSectionCssVars.mini(theme)).toMatchObject({
      '--nav-item-root-height': '56px',
      '--nav-item-sub-height': '34px',
      '--nav-icon-size': '22px',
    });
  });

  it('paints the active root in the brand color, its title one readable stage darker', () => {
    const { palette } = theme.vars;
    const vars = navSectionCssVars.vertical(theme);

    // Minimal's `primary.main` row; only the text drops to `primary.dark`
    // (coral `main` is 2.4:1 as text on the wash).
    expect(vars['--nav-item-root-active-color']).toBe(palette.primary.main);
    expect(vars['--nav-item-root-active-title-color']).toBe(palette.primary.dark);
    // varAlpha renders the channel wash as `rgba(var(--…-mainChannel …) / 8%)`.
    expect(vars['--nav-item-root-active-bg']).toContain('primary-mainChannel');
    expect(vars['--nav-item-root-active-bg']).toContain('8%');
    expect(vars['--nav-item-root-active-hover-bg']).toContain('16%');
    // Dark scheme: Minimal's `--nav-item-root-active-color-on-dark` for both.
    expect(vars).toMatchObject(
      theme.applyStyles('dark', {
        '--nav-item-root-active-color': palette.primary.light,
        '--nav-item-root-active-title-color': palette.primary.light,
      }),
    );
  });

  it("keeps Minimal's grey sub treatment: ink on action.hover (vertical) / action.selected (mini)", () => {
    const { palette } = theme.vars;
    const vertical = navSectionCssVars.vertical(theme);
    const mini = navSectionCssVars.mini(theme);

    expect(vertical['--nav-item-sub-active-color']).toBe(palette.text.primary);
    expect(vertical['--nav-item-sub-active-bg']).toBe(palette.action.hover);
    expect(mini['--nav-item-sub-active-color']).toBe(palette.text.primary);
    expect(mini['--nav-item-sub-active-bg']).toBe(palette.action.selected);
  });

  it('draws the tree connector with the divider role, expanded rail only', () => {
    // ui-design-system.md §8: connectors use `palette.divider`. Minimal
    // hardcodes #EDEFF2 / #282F37, which would ignore the contrast option.
    expect(navSectionCssVars.vertical(theme)).toMatchObject({
      '--nav-bullet-size': '12px',
      '--nav-bullet-color': theme.vars.palette.divider,
    });
    expect(navSectionCssVars.mini(theme)).not.toHaveProperty('--nav-bullet-size');
    expect(navSectionCssVars.mini(theme)).not.toHaveProperty('--nav-bullet-color');
  });
});
