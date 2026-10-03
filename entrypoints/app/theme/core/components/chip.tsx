import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { Theme, CSSObject, Components, ComponentsVariants } from '@mui/material/styles';

import SvgIcon from '@mui/material/SvgIcon';
import { chipClasses } from '@mui/material/Chip';

import { colorKeys } from '../palette';

/**
 * Minimal chip: `soft` is the default variant, radius 8 (small) / 10 (medium).
 * Soft-primary text and the 24% palette hover wash go through the favbase
 * `softStyles` overrides, not through this file.
 *
 * MUI's own `:hover` and `.Mui-focusVisible` rules paint a clickable palette
 * chip `palette[color].dark` (two classes each). Soft needs no override for
 * focus: it re-emits its 16% base under `&.MuiChip-clickable` (also two
 * classes, emitted later), so a focused chip keeps its rest wash plus the
 * CssBaseline ring. Filled does: its rest is `main` under the ink
 * `contrastText`, and `.dark` fails 4.5:1 for four presets, so the filled
 * palette variant below keeps `main` on hover and focus at three classes
 * (emitted CSS checked 2026-10-02 for both). The `.dark` focus rule still wins
 * for an `onDelete`-only palette chip of either variant (no clickable class);
 * none exists in app.html.
 */
export type ChipExtendVariant = { soft: true };
export type ChipExtendColor = { black: true; white: true };

type ChipVariants = ComponentsVariants<Theme>['MuiChip'];

const baseColors = ['default'] as const;
const allColors = [...baseColors, ...colorKeys.palette, ...colorKeys.common] as const;

const DIMENSIONS: Record<'small' | 'medium', CSSObject> = {
  small: { borderRadius: '8px' },
  medium: { borderRadius: '10px' },
};

// ➤ Custom icons
const DeleteIcon = (props: SvgIconProps) => (
  // https://icon-sets.iconify.design/solar/close-circle-bold/
  <SvgIcon {...props}>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10M8.97 8.97a.75.75 0 0 1 1.06 0L12 10.94l1.97-1.97a.75.75 0 0 1 1.06 1.06L13.06 12l1.97 1.97a.75.75 0 0 1-1.06 1.06L12 13.06l-1.97 1.97a.75.75 0 0 1-1.06-1.06L10.94 12l-1.97-1.97a.75.75 0 0 1 0-1.06"
      clipRule="evenodd"
    />
  </SvgIcon>
);

// ➤ Variants
const filledVariants = [
  {
    props: (props) => props.variant === 'filled' && props.color === 'default',
    style: ({ theme }) => ({
      ...theme.mixins.filledStyles(theme, 'inherit'),
      [`&.${chipClasses.clickable}`]: {
        ...theme.mixins.filledStyles(theme, 'inherit', { hover: true }),
      },
    }),
  },
  ...(colorKeys.common.map((colorKey) => ({
    props: (props) => props.variant === 'filled' && props.color === colorKey,
    style: ({ theme }) => ({
      ...theme.mixins.filledStyles(theme, colorKey),
      [`&.${chipClasses.clickable}`]: {
        ...theme.mixins.filledStyles(theme, colorKey, { hover: true }),
      },
    }),
  })) satisfies ChipVariants),
  ...(colorKeys.palette.map((colorKey) => ({
    props: (props) => props.variant === 'filled' && props.color === colorKey,
    style: ({ theme }) => ({
      // favbase override: MUI paints a clickable palette chip `.dark` on
      // `:hover` and `.Mui-focusVisible`, which drops the ink `contrastText`
      // below 4.5:1 (coral 3.69, preset1 2.26, preset4 4.06, preset5 2.60);
      // `main` is the per-preset pair D14 already clears. Same fix as the
      // contained button. Nested under the clickable class so it wins on
      // specificity (three classes over MUI's two), not on emission order; the
      // disabled rule below has three as well and is emitted later. The hover
      // shadow also outranks MUI's `:active` `shadows[1]` while pressed.
      [`&.${chipClasses.clickable}`]: {
        '&:hover': {
          backgroundColor: theme.vars.palette[colorKey].main,
          boxShadow: theme.vars.customShadows[colorKey],
        },
        [`&.${chipClasses.focusVisible}`]: {
          backgroundColor: theme.vars.palette[colorKey].main,
        },
      },
    }),
  })) satisfies ChipVariants),
] satisfies ChipVariants;

const outlinedVariants = [
  {
    props: (props) => props.variant === 'outlined',
    style: {
      borderColor: 'currentColor',
    },
  },
  {
    props: (props) => props.variant === 'outlined' && props.color === 'default',
    style: ({ theme }) => ({
      borderColor: theme.vars.palette.shared.buttonOutlined,
    }),
  },
  ...(colorKeys.common.map((colorKey) => ({
    props: (props) => props.variant === 'outlined' && props.color === colorKey,
    style: ({ theme }) => ({
      color: theme.vars.palette.common[colorKey],
    }),
  })) satisfies ChipVariants),
] satisfies ChipVariants;

const softVariants = [
  ...(allColors.map((colorKey) => ({
    props: (props) => props.variant === 'soft' && props.color === colorKey,
    style: ({ theme }) => {
      const currentColor = colorKey === 'default' ? 'inherit' : colorKey;

      return {
        ...theme.mixins.softStyles(theme, currentColor),
        [`&.${chipClasses.clickable}`]: {
          ...theme.mixins.softStyles(theme, currentColor, { hover: true }),
        },
      };
    },
  })) satisfies ChipVariants),
] satisfies ChipVariants;

const avatarVariants = [
  ...(colorKeys.common.map((colorKey) => ({
    props: (props) => props.color === colorKey,
    style: {
      color: 'inherit',
      backgroundColor: 'color-mix(in srgb, currentColor 24%, transparent)',
    },
  })) satisfies ChipVariants),
  ...(colorKeys.palette.map((colorKey) => ({
    props: (props) => props.color === colorKey,
    style: ({ theme }) => ({
      color: theme.vars.palette[colorKey].lighter,
      backgroundColor: theme.vars.palette[colorKey].dark,
    }),
  })) satisfies ChipVariants),
] satisfies ChipVariants;

const sizeVariants = [
  {
    props: (props) => props.size === 'small',
    style: { ...DIMENSIONS.small },
  },
  {
    props: (props) => props.size === 'medium',
    style: { ...DIMENSIONS.medium },
  },
] satisfies ChipVariants;

const disabledVariants = [
  {
    props: {},
    style: ({ theme }) => ({
      [`&.${chipClasses.disabled}`]: {
        opacity: 1,
        color: theme.vars.palette.action.disabled,
        [`&:not(.${chipClasses.outlined})`]: {
          backgroundColor: theme.vars.palette.action.disabledBackground,
        },
        [`&.${chipClasses.outlined}`]: {
          borderColor: theme.vars.palette.action.disabledBackground,
        },
        [`& .${chipClasses.avatar}`]: {
          color: theme.vars.palette.action.disabled,
          backgroundColor: theme.vars.palette.action.disabledBackground,
          '& img': { opacity: theme.vars.palette.action.disabledOpacity },
        },
      },
    }),
  },
] satisfies ChipVariants;

// ➤ Components
const MuiChip: Components<Theme>['MuiChip'] = {
  defaultProps: {
    deleteIcon: <DeleteIcon />,
    variant: 'soft',
  },
  styleOverrides: {
    root: {
      variants: [
        ...filledVariants,
        ...outlinedVariants,
        ...softVariants,
        ...sizeVariants,
        ...disabledVariants,
      ],
    },
    label: ({ theme }) => ({
      fontWeight: theme.typography.fontWeightMedium,
    }),
    avatar: {
      variants: [...avatarVariants],
    },
    icon: {
      color: 'currentColor',
    },
    deleteIcon: {
      opacity: 0.48,
      color: 'currentColor',
      '&:hover': {
        opacity: 0.8,
        color: 'currentColor',
      },
    },
  },
};

export const chip: Components<Theme> = {
  MuiChip,
};
