import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

// favbase override: Minimal has no CssBaseline entry. Browser-owned surfaces
// (scrollbars, text selection, caret, focus ring, numerals) ship with UA
// defaults that ignore the theme. Channel alphas resolve per color scheme; the
// focus ring is the one rule that must branch, because the ink-dark accent
// vanishes on dark paper.
const MuiCssBaseline: Components<Theme>['MuiCssBaseline'] = {
  styleOverrides: (theme) => ({
    // Every figure that can change (counts, progress, pagination, dates) stays
    // put when it changes. DM Sans and Barlow both carry tabular figures.
    body: { fontVariantNumeric: 'tabular-nums' },
    '*::-webkit-scrollbar': { width: 8, height: 8 },
    '*::-webkit-scrollbar-thumb': {
      borderRadius: Number(theme.shape.borderRadius),
      backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.32),
    },
    '*::-webkit-scrollbar-thumb:hover': {
      backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.48),
    },
    '*::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
    '::selection': {
      color: theme.vars.palette.text.primary,
      backgroundColor: theme.vars.palette.primary.lighter,
    },
    'input, textarea': { caretColor: theme.vars.palette.text.primary },
    'a:focus-visible, button:focus-visible, [tabindex]:focus-visible': {
      outline: `2px solid ${theme.vars.palette.primary.darker}`,
      outlineOffset: 2,
      ...theme.applyStyles('dark', {
        outline: `2px solid ${theme.vars.palette.primary.main}`,
      }),
    },
  }),
};

export const cssBaseline: Components<Theme> = {
  MuiCssBaseline,
};
