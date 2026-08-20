import type { Theme, Components } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

const MuiCssBaseline: Components<Theme>['MuiCssBaseline'] = {
  // Browser-owned surfaces (scrollbars, text selection, caret, focus ring)
  // ship with UA defaults that ignore the theme; grey/primary channel alphas
  // resolve per color scheme, so one rule set covers light and dark.
  styleOverrides: (theme) => ({
    '*::-webkit-scrollbar': { width: 8, height: 8 },
    '*::-webkit-scrollbar-thumb': {
      borderRadius: 4,
      backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.32),
    },
    '*::-webkit-scrollbar-thumb:hover': {
      backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.48),
    },
    '*::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
    '::selection': {
      backgroundColor: varAlpha(theme.vars.palette.primary.mainChannel, 0.24),
    },
    'input, textarea': { caretColor: theme.vars.palette.primary.main },
    'a:focus-visible, button:focus-visible': {
      outline: `2px solid ${varAlpha(theme.vars.palette.primary.mainChannel, 0.48)}`,
      outlineOffset: 2,
    },
  }),
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
    containedInherit: ({ theme }) => ({
      color: theme.vars.palette.common.white,
      backgroundColor: theme.vars.palette.grey[800],
      '&:hover': {
        color: theme.vars.palette.common.white,
        backgroundColor: theme.vars.palette.grey[800],
      },
    }),
    sizeLarge: { minHeight: 48 },
  },
};

const MuiCard: Components<Theme>['MuiCard'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      zIndex: 0,
      position: 'relative',
      boxShadow: theme.vars.customShadows.card,
      borderRadius: Number(theme.shape.borderRadius) * 2,
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
      borderColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.2),
    }),
  },
};

const MuiTooltip: Components<Theme>['MuiTooltip'] = {
  styleOverrides: {
    tooltip: ({ theme }) => ({
      backgroundColor: theme.vars.palette.grey[800],
      borderRadius: Number(theme.shape.borderRadius) * 0.75,
      // grey is scheme-invariant; on dark paper (grey800) step up to grey700.
      ...theme.applyStyles('dark', {
        backgroundColor: theme.vars.palette.grey[700],
      }),
    }),
    arrow: ({ theme }) => ({
      color: theme.vars.palette.grey[800],
      ...theme.applyStyles('dark', { color: theme.vars.palette.grey[700] }),
    }),
  },
};

const MuiPopover: Components<Theme>['MuiPopover'] = {
  styleOverrides: {
    // Also covers Menu and Select dropdown papers.
    paper: ({ theme }) => ({
      boxShadow: theme.vars.customShadows.dropdown,
      borderRadius: Number(theme.shape.borderRadius) * 1.25,
    }),
  },
};

const MuiDialog: Components<Theme>['MuiDialog'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      boxShadow: theme.vars.customShadows.dialog,
      borderRadius: Number(theme.shape.borderRadius) * 2,
    }),
  },
};

const MuiLinearProgress: Components<Theme>['MuiLinearProgress'] = {
  styleOverrides: {
    root: { borderRadius: 4 },
  },
};

const MuiChip: Components<Theme>['MuiChip'] = {
  styleOverrides: {
    outlined: ({ theme }) => ({
      // Default-color filter chips align with the system border alpha;
      // semantic-color outlined chips keep their own border.
      '&.MuiChip-colorDefault': {
        borderColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.24),
      },
    }),
  },
};

const MuiPaper: Components<Theme>['MuiPaper'] = {
  defaultProps: { elevation: 0 },
  styleOverrides: {
    root: { backgroundImage: 'none' },
    outlined: ({ theme }) => ({
      borderColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.16),
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
      borderRadius: Number(theme.shape.borderRadius) * 0.75,
      marginInline: theme.spacing(0.5),
    }),
  },
};

const MuiLink: Components<Theme>['MuiLink'] = {
  defaultProps: { underline: 'hover' },
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
  MuiCssBaseline,
  MuiOutlinedInput,
  MuiLinearProgress,
  MuiFormControlLabel,
};
