import type { Theme } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

/**
 * Nav geometry and colors (Minimal `nav-section/styles/css-vars.ts`, vertical +
 * mini only). This file is the single owner of nav row heights — before docs/25
 * Step 4 they lived in `layouts/dashboard/css-vars.ts`, which now only owns the
 * shell (rail width, content gutters, transition).
 */

/**
 * favbase override of Minimal's active colors: one treatment for both levels —
 * the derived accent ink (`text.accent`, WCAG-safe under every color preset)
 * over an 8% brand wash. Minimal uses `primary.main` (2.5:1 on paper) at root
 * and a grey `action.selected` on sub items; Favbase keeps the brand wash so
 * the active row reads the same wherever it sits in the tree.
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
    '--nav-item-root-active-color': palette.text.accent,
    '--nav-item-root-active-bg': varAlpha(palette.primary.mainChannel, 0.08),
    '--nav-item-root-active-hover-bg': varAlpha(palette.primary.mainChannel, 0.16),
    '--nav-item-root-open-color': palette.text.primary,
    '--nav-item-root-open-bg': palette.action.hover,
    // sub
    '--nav-item-sub-active-color': palette.text.accent,
    '--nav-item-sub-active-bg': varAlpha(palette.primary.mainChannel, 0.08),
    '--nav-item-sub-active-hover-bg': varAlpha(palette.primary.mainChannel, 0.16),
    '--nav-item-sub-open-color': palette.text.primary,
    '--nav-item-sub-open-bg': palette.action.hover,
    ...(variant === 'vertical' && {
      '--nav-subheader-color': palette.text.disabled,
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
