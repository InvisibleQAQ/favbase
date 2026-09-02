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

  it('gives both levels one active treatment: accent ink on an 8% brand wash', () => {
    const vars = navSectionCssVars.vertical(theme);

    // favbase override of Minimal (primary.main at root, grey action.selected on
    // sub items): the derived accent clears WCAG under every preset, and one
    // treatment means the active row reads the same at any depth.
    expect(vars['--nav-item-root-active-color']).toBe(theme.vars.palette.text.accent);
    expect(vars['--nav-item-sub-active-color']).toBe(theme.vars.palette.text.accent);
    expect(vars['--nav-item-root-active-bg']).toBe(vars['--nav-item-sub-active-bg']);
    // varAlpha renders the channel wash as `rgba(var(--…-mainChannel …) / 8%)`.
    expect(vars['--nav-item-root-active-bg']).toContain('primary-mainChannel');
    expect(vars['--nav-item-root-active-bg']).toContain('8%');
    expect(vars['--nav-item-root-active-hover-bg']).toContain('16%');
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
