import type { Theme } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

/**
 * Nav geometry and colors (Minimal `nav-section/styles/css-vars.ts`, vertical +
 * mini only). This file is the single owner of nav row heights — before docs/25
 * Step 4 they lived in `layouts/dashboard/css-vars.ts`, which now only owns the
 * shell (rail width, content gutters, transition).
 */

/**
 * Active colors follow Minimal, with one readability override (user decision
 * 2026-10-14). Root: the row — icon, disclosure arrow — in `primary.main`, but
 * the title in `primary.dark`: `main` is 2.4:1 as coral text on the 8% wash,
 * `dark` is the lightest stage that still reads (4.3:1). The dark scheme uses
 * `primary.light` for both, Minimal's `--nav-item-root-active-color-on-dark`.
 * Sub: Minimal's grey treatment; the brand color stays on the parent row.
 */
function colorVars(theme: Theme, variant: 'vertical' | 'mini') {
  const {
    vars: { palette },
  } = theme;

  return {
    '--nav-item-color': palette.text.secondary,
    '--nav-item-hover-bg': palette.action.hover,
    '--nav-item-caption-color': palette.text.disabled,
    // root
    '--nav-item-root-active-color': palette.primary.main,
    '--nav-item-root-active-title-color': palette.primary.dark,
    '--nav-item-root-active-bg': varAlpha(palette.primary.mainChannel, 0.08),
    '--nav-item-root-active-hover-bg': varAlpha(palette.primary.mainChannel, 0.16),
    '--nav-item-root-open-color': palette.text.primary,
    '--nav-item-root-open-bg': palette.action.hover,
    // sub
    '--nav-item-sub-active-color': palette.text.primary,
    '--nav-item-sub-active-bg': palette.action.selected,
    '--nav-item-sub-open-color': palette.text.primary,
    '--nav-item-sub-open-bg': palette.action.hover,
    ...(variant === 'vertical' && {
      '--nav-item-sub-active-bg': palette.action.hover,
      '--nav-subheader-color': palette.text.disabled,
    }),
    ...theme.applyStyles('dark', {
      '--nav-item-root-active-color': palette.primary.light,
      '--nav-item-root-active-title-color': palette.primary.light,
    }),
  };
}

function verticalVars(theme: Theme) {
  const {
    shape,
    vars: { palette },
  } = theme;

  return {
    ...colorVars(theme, 'vertical'),
    '--nav-item-gap': '4px',
    '--nav-item-radius': `${shape.borderRadius}px`,
    '--nav-item-pt': '4px',
    '--nav-item-pr': '8px',
    '--nav-item-pb': '4px',
    '--nav-item-pl': '12px',
    // root
    '--nav-item-root-height': '44px',
    // sub
    '--nav-item-sub-height': '36px',
    // icon
    '--nav-icon-size': '24px',
    '--nav-icon-margin': '0 12px 0 0',
    // bullet + spine connector
    '--nav-bullet-size': '12px',
    // favbase: Minimal hardcodes #EDEFF2 / #282F37 here. `divider`
    // (grey-500 @ 20%) lands within a shade of both, is the role the design
    // system reserves for tree connectors, and follows the scheme — including
    // the high-contrast option — instead of freezing two neutrals.
    '--nav-bullet-color': palette.divider,
  };
}

function miniVars(theme: Theme) {
  const { shape } = theme;

  return {
    ...colorVars(theme, 'mini'),
    '--nav-item-gap': '4px',
    '--nav-item-radius': `${shape.borderRadius}px`,
    // root
    '--nav-item-root-height': '56px',
    '--nav-item-root-padding': '8px 4px 6px 4px',
    // sub
    '--nav-item-sub-height': '34px',
    '--nav-item-sub-padding': '0 8px',
    // icon
    '--nav-icon-size': '22px',
    '--nav-icon-root-margin': '0 0 6px 0',
    '--nav-icon-sub-margin': '0 8px 0 0',
  };
}

export const navSectionCssVars = {
  mini: miniVars,
  vertical: verticalVars,
};
