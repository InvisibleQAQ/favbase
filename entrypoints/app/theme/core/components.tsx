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
    sizeSmall: { minHeight: 30 },
    sizeMedium: { minHeight: 36 },
    sizeLarge: { minHeight: 48 },
  },
};

const MuiCard: Components<Theme>['MuiCard'] = {
  styleOverrides: {
    // Light entries float softly; dark entries use a hairline against the
    // shallower paper/default surface step. Neither scheme combines both.
    root: ({ theme }) => ({
      zIndex: 0,
      position: 'relative',
      boxShadow: theme.vars.customShadows.card,
      backgroundImage: 'none',
      borderRadius: Number(theme.shape.borderRadius),
      ...theme.applyStyles('dark', {
        boxShadow: 'none',
        border: `1px solid ${theme.vars.palette.divider}`,
      }),
    }),
  },
};

const MuiCardHeader: Components<Theme>['MuiCardHeader'] = {
  defaultProps: {
    slotProps: {
      title: { variant: 'h6' },
      subheader: { variant: 'body2' },
    },
  },
  styleOverrides: {
    root: ({ theme }) => ({ padding: theme.spacing(3, 3, 0) }),
  },
};

const MuiCardContent: Components<Theme>['MuiCardContent'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(3),
      '&:last-child': { paddingBottom: theme.spacing(3) },
    }),
  },
};

const MuiInputBase: Components<Theme>['MuiInputBase'] = {
  styleOverrides: {
    root: ({ ownerState }) => ({
      ...(!ownerState.multiline && {
        minHeight: ownerState.size === 'small' ? 40 : 48,
      }),
    }),
    input: ({ ownerState }) => ({
      lineHeight: '24px',
      ...(!ownerState.multiline && {
        paddingBlock: ownerState.size === 'small' ? 8 : 12,
      }),
    }),
  },
};

const MuiInput: Components<Theme>['MuiInput'] = {
  styleOverrides: {
    root: ({ ownerState, theme }) => ({
      ...(!ownerState.multiline && { minHeight: ownerState.size === 'small' ? 40 : 48 }),
      borderRadius: Number(theme.shape.borderRadius),
    }),
    input: ({ ownerState }) => ({
      ...(!ownerState.multiline && {
        paddingBlock: ownerState.size === 'small' ? 8 : 12,
      }),
    }),
  },
};

const MuiFilledInput: Components<Theme>['MuiFilledInput'] = {
  defaultProps: { disableUnderline: true },
  styleOverrides: {
    root: ({ ownerState, theme }) => ({
      borderRadius: Number(theme.shape.borderRadius),
      ...(!ownerState.multiline && {
        minHeight: ownerState.size === 'small' ? 40 : 48,
      }),
    }),
    input: ({ ownerState }) => ({
      ...(!ownerState.multiline && {
        paddingBlock: ownerState.size === 'small' ? 8 : 12,
      }),
    }),
  },
};

const MuiTextField: Components<Theme>['MuiTextField'] = {
  defaultProps: { variant: 'outlined' },
};

const MuiOutlinedInput: Components<Theme>['MuiOutlinedInput'] = {
  styleOverrides: {
    root: ({ ownerState, theme }) => ({
      borderRadius: Number(theme.shape.borderRadius),
      ...(!ownerState.multiline && {
        minHeight: ownerState.size === 'small' ? 40 : 48,
      }),
    }),
    input: ({ ownerState }) => ({
      ...(!ownerState.multiline && {
        paddingBlock: ownerState.size === 'small' ? 8 : 12,
      }),
    }),
    notchedOutline: ({ theme }) => ({
      borderColor: theme.vars.palette.divider,
    }),
  },
};

const MuiInputLabel: Components<Theme>['MuiInputLabel'] = {
  styleOverrides: {
    outlined: ({ ownerState }) => ({
      ...(!ownerState.shrink && {
        transform:
          ownerState.size === 'small'
            ? 'translate(14px, 9px) scale(1)'
            : 'translate(14px, 12px) scale(1)',
      }),
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
      borderRadius: Number(theme.shape.borderRadius) * 0.75,
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
      borderRadius: Number(theme.shape.borderRadius),
      border: `1px solid ${theme.vars.palette.divider}`,
    }),
  },
};

const MuiDialog: Components<Theme>['MuiDialog'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      boxShadow: theme.vars.customShadows.dialog,
      borderRadius: Number(theme.shape.borderRadius),
    }),
  },
};

const MuiLinearProgress: Components<Theme>['MuiLinearProgress'] = {
  styleOverrides: {
    root: ({ theme }) => ({ borderRadius: Number(theme.shape.borderRadius) * 0.5 }),
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
      borderRadius: Number(theme.shape.borderRadius) * 0.75,
      marginInline: theme.spacing(0.5),
    }),
  },
};

const MuiTabs: Components<Theme>['MuiTabs'] = {
  styleOverrides: {
    root: { minHeight: 48 },
  },
};

const MuiTab: Components<Theme>['MuiTab'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      minHeight: 48,
      ...theme.typography.button,
      color: theme.vars.palette.text.secondary,
      '&.Mui-selected': { color: theme.vars.palette.text.primary },
    }),
  },
};

const MuiSkeleton: Components<Theme>['MuiSkeleton'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      backgroundColor: varAlpha(theme.vars.palette.grey['400Channel'], 0.12),
    }),
    rounded: ({ theme }) => ({ borderRadius: Number(theme.shape.borderRadius) }),
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
  MuiInput,
  MuiInputBase,
  MuiTextField,
  MuiFilledInput,
  MuiTab,
  MuiTabs,
  MuiChip,
  MuiLink,
  MuiPaper,
  MuiButton,
  MuiDialog,
  MuiPopover,
  MuiTooltip,
  MuiBackdrop,
  MuiMenuItem,
  MuiSkeleton,
  MuiTableCell,
  MuiCardHeader,
  MuiCardContent,
  MuiTypography,
  MuiCssBaseline,
  MuiInputLabel,
  MuiOutlinedInput,
  MuiLinearProgress,
  MuiFormControlLabel,
};
