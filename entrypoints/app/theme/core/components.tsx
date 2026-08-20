import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

const MuiCssBaseline: Components<Theme>['MuiCssBaseline'] = {
  // Browser-owned surfaces (scrollbars, text selection, caret, focus ring,
  // numerals) ship with UA defaults that ignore the theme. Channel alphas
  // resolve per color scheme; the focus ring is the one rule that must branch,
  // because the ink-dark accent vanishes on dark paper.
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

const MuiTypography: Components<Theme>['MuiTypography'] = {
  defaultProps: {
    // Card titles and sub-captions are not section headings: one page, one h1.
    variantMapping: { subtitle1: 'p', subtitle2: 'p' },
  },
};

const MuiBackdrop: Components<Theme>['MuiBackdrop'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      backgroundColor: varAlpha(theme.vars.palette.grey['900Channel'], 0.8),
    }),
    invisible: { background: 'transparent' },
  },
};

const MuiButton: Components<Theme>['MuiButton'] = {
  defaultProps: { disableElevation: true },
  styleOverrides: {
    // The one inverted element per screen: ink on paper, paper on ink.
    // Coral never sits under white text (2.5:1).
    containedPrimary: ({ theme }) => ({
      color: theme.vars.palette.common.white,
      backgroundColor: theme.vars.palette.grey[900],
      '&:hover': { backgroundColor: theme.vars.palette.grey[800] },
      ...theme.applyStyles('dark', {
        color: theme.vars.palette.grey[900],
        backgroundColor: theme.vars.palette.grey[100],
        '&:hover': { backgroundColor: theme.vars.palette.grey[200] },
      }),
    }),
    containedInherit: ({ theme }) => ({
      color: theme.vars.palette.common.white,
      backgroundColor: theme.vars.palette.grey[800],
      '&:hover': {
        color: theme.vars.palette.common.white,
        backgroundColor: theme.vars.palette.grey[800],
      },
    }),
    outlinedPrimary: ({ theme }) => ({
      color: theme.vars.palette.text.accent,
      borderColor: varAlpha(theme.vars.palette.text.accentChannel, 0.48),
      '&:hover': {
        borderColor: theme.vars.palette.text.accent,
        backgroundColor: theme.vars.palette.primary.lighter,
      },
    }),
    textPrimary: ({ theme }) => ({
      color: theme.vars.palette.text.accent,
      '&:hover': { backgroundColor: theme.vars.palette.primary.lighter },
    }),
    sizeLarge: { minHeight: 48 },
  },
};

const MuiCard: Components<Theme>['MuiCard'] = {
  styleOverrides: {
    // An entry declares its elevation once: a hairline, never a shadow.
    root: ({ theme }) => ({
      zIndex: 0,
      position: 'relative',
      boxShadow: 'none',
      backgroundImage: 'none',
      border: `1px solid ${theme.vars.palette.divider}`,
      borderRadius: Number(theme.shape.borderRadius) * 3,
    }),
  },
};

const MuiCardHeader: Components<Theme>['MuiCardHeader'] = {
  defaultProps: {
    titleTypographyProps: { variant: 'h6' },
    subheaderTypographyProps: { variant: 'body2' },
  },
  styleOverrides: {
    root: ({ theme }) => ({ padding: theme.spacing(3, 3, 0) }),
  },
};

const MuiOutlinedInput: Components<Theme>['MuiOutlinedInput'] = {
  styleOverrides: {
    notchedOutline: ({ theme }) => ({
      borderColor: theme.vars.palette.divider,
    }),
  },
};

const MuiTooltip: Components<Theme>['MuiTooltip'] = {
  styleOverrides: {
    // Grey is scheme-invariant, so the inversion has to be spelled out:
    // ink bubble on paper, paper bubble on ink.
    tooltip: ({ theme }) => ({
      color: theme.vars.palette.common.white,
      backgroundColor: theme.vars.palette.grey[800],
      borderRadius: Number(theme.shape.borderRadius),
      ...theme.applyStyles('dark', {
        color: theme.vars.palette.grey[900],
        backgroundColor: theme.vars.palette.grey[200],
      }),
    }),
    arrow: ({ theme }) => ({
      color: theme.vars.palette.grey[800],
      ...theme.applyStyles('dark', { color: theme.vars.palette.grey[200] }),
    }),
  },
};

const MuiPopover: Components<Theme>['MuiPopover'] = {
  styleOverrides: {
    // Also covers Menu and Select dropdown papers — the only surfaces that cast.
    paper: ({ theme }) => ({
      boxShadow: theme.vars.customShadows.dropdown,
      borderRadius: Number(theme.shape.borderRadius) * 2,
      border: `1px solid ${theme.vars.palette.divider}`,
    }),
  },
};

const MuiDialog: Components<Theme>['MuiDialog'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      boxShadow: theme.vars.customShadows.dialog,
      borderRadius: Number(theme.shape.borderRadius) * 3,
    }),
  },
};

const MuiLinearProgress: Components<Theme>['MuiLinearProgress'] = {
  styleOverrides: {
    root: ({ theme }) => ({ borderRadius: Number(theme.shape.borderRadius) }),
  },
};

const MuiChip: Components<Theme>['MuiChip'] = {
  styleOverrides: {
    // The stamp: coral block, ink text (contrastText). Hover lifts to the
    // lighter coral rather than darkening under ink.
    filledPrimary: ({ theme }) => ({
      '&.MuiChip-clickable:hover': {
        backgroundColor: theme.vars.palette.primary.light,
      },
    }),
    outlined: ({ theme }) => ({
      // Default-color filter chips share the hairline; semantic-color
      // outlined chips keep their own border.
      '&.MuiChip-colorDefault': {
        borderColor: theme.vars.palette.divider,
      },
    }),
  },
};

const MuiPaper: Components<Theme>['MuiPaper'] = {
  defaultProps: { elevation: 0 },
  styleOverrides: {
    root: { backgroundImage: 'none' },
    outlined: ({ theme }) => ({
      borderColor: theme.vars.palette.divider,
    }),
  },
};

const MuiTableCell: Components<Theme>['MuiTableCell'] = {
  styleOverrides: {
    head: ({ theme }) => ({
      fontSize: theme.typography.pxToRem(14),
      color: theme.vars.palette.text.secondary,
      fontWeight: theme.typography.fontWeightSemiBold,
      backgroundColor: theme.vars.palette.background.neutral,
    }),
  },
};

const MuiMenuItem: Components<Theme>['MuiMenuItem'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      ...theme.typography.body2,
      borderRadius: Number(theme.shape.borderRadius),
      marginInline: theme.spacing(0.5),
    }),
  },
};

const MuiLink: Components<Theme>['MuiLink'] = {
  defaultProps: { underline: 'hover' },
  styleOverrides: {
    root: ({ theme }) => ({ color: theme.vars.palette.text.accent }),
  },
};

const MuiFormControlLabel: Components<Theme>['MuiFormControlLabel'] = {
  styleOverrides: {
    label: ({ theme }) => ({ ...theme.typography.body2 }),
  },
};

export const components = {
  MuiCard,
  MuiChip,
  MuiLink,
  MuiPaper,
  MuiButton,
  MuiDialog,
  MuiPopover,
  MuiTooltip,
  MuiBackdrop,
  MuiMenuItem,
  MuiTableCell,
  MuiCardHeader,
  MuiTypography,
  MuiCssBaseline,
  MuiOutlinedInput,
  MuiLinearProgress,
  MuiFormControlLabel,
};
