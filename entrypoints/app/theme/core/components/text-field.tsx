import type { InputBaseClasses } from '@mui/material/InputBase';
import type { OutlinedInputClasses } from '@mui/material/OutlinedInput';
import type { FilledInputProps, FilledInputClasses } from '@mui/material/FilledInput';
import type { Theme, CSSObject, Components, ComponentsVariants } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';
import { inputBaseClasses } from '@mui/material/InputBase';
import { filledInputClasses } from '@mui/material/FilledInput';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import { inputAdornmentClasses } from '@mui/material/InputAdornment';

/**
 * Minimal text inputs without the MUI X date-picker context (Favbase has no
 * `@mui/x-date-pickers`). Single-line height is padding + the 24px line box:
 * outlined medium 56 / small 40 (docs/25 D11); the theme sets no `minHeight`.
 */

type InputSizeProps = Pick<FilledInputProps, 'size' | 'hiddenLabel'>;

type InputBaseVariants = ComponentsVariants<Theme>['MuiInputBase'];
type OutlinedInputVariants = ComponentsVariants<Theme>['MuiOutlinedInput'];
type FilledInputVariants = ComponentsVariants<Theme>['MuiFilledInput'];

export const INPUT_TYPOGRAPHY = {
  fontSize: { base: 15, responsive: 16 },
  lineHeight: 24,
} as const;

export const INPUT_PADDING = {
  base: {
    small: { paddingTop: 0, paddingBottom: 4 },
    medium: { paddingTop: 4, paddingBottom: 4 },
  },
  outlined: {
    small: { paddingTop: 8, paddingBottom: 8 },
    medium: { paddingTop: 16, paddingBottom: 16 },
  },
  filled: {
    small: { paddingTop: 20 },
    medium: { paddingTop: 24 },
    smallHidden: { paddingTop: 8, paddingBottom: 8 },
    mediumHidden: { paddingTop: 16, paddingBottom: 16 },
  },
} satisfies Record<string, Record<string, CSSObject>>;

export function getInputTypography(
  theme: Theme,
  keys: Array<'fontSize' | 'height' | 'lineHeight'>,
): CSSObject {
  const { fontSize, lineHeight } = INPUT_TYPOGRAPHY;

  const baseStyles = {
    fontSize: theme.typography.pxToRem(fontSize.base),
    height: `${lineHeight}px`,
    lineHeight: `${lineHeight}px`,
  };

  const responsiveStyles = {
    fontSize: theme.typography.pxToRem(fontSize.responsive),
    height: `${lineHeight}px`,
    lineHeight: `${lineHeight}px`,
  };

  return {
    ...Object.fromEntries(keys.map((k) => [k, baseStyles[k]])),
    [theme.breakpoints.down('sm')]: Object.fromEntries(keys.map((k) => [k, responsiveStyles[k]])),
  };
}

// ➤ InputBase
export const inputBaseStyles = {
  root: (theme: Theme, classes: Partial<InputBaseClasses>): CSSObject => ({
    '--disabled-color': theme.vars.palette.action.disabled,
    ...getInputTypography(theme, ['lineHeight']),
    [`&.${classes.disabled}`]: {
      [`& .${inputAdornmentClasses.root} *`]: { color: 'var(--disabled-color)' },
      [`& .${classes.input}`]: { WebkitTextFillColor: 'var(--disabled-color)' },
    },
  }),
  input: (theme: Theme): CSSObject => ({
    ...getInputTypography(theme, ['fontSize', 'height', 'lineHeight']),
    '&:focus': { borderRadius: 'inherit' },
    '&::placeholder, &::-webkit-input-placeholder, &::-moz-placeholder, &:-ms-input-placeholder, &::-ms-input-placeholder':
      { color: theme.vars.palette.text.disabled },
  }),
};

export const inputBaseVariants = {
  root: [
    {
      props: (props) => !!props.multiline,
      style: { ...INPUT_PADDING.base.medium },
    },
    {
      props: (props) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.base.small },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.base.medium },
    },
    {
      props: ({ size }: InputSizeProps) => size === 'small',
      style: { ...INPUT_PADDING.base.small },
    },
  ],
} satisfies {
  root: InputBaseVariants;
  input: InputBaseVariants;
};

const multilineInputVariants = [
  {
    props: (props) => !!props.multiline,
    style: { padding: 0 },
  },
] satisfies InputBaseVariants;

const MuiInputBase: Components<Theme>['MuiInputBase'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      ...inputBaseStyles.root(theme, inputBaseClasses),
      variants: inputBaseVariants.root,
    }),
    input: ({ theme }) => ({
      ...inputBaseStyles.input(theme),
      variants: [...inputBaseVariants.input, ...multilineInputVariants],
    }),
  },
};

// ➤ Input
export const inputStyles = {
  root: (theme: Theme): CSSObject => ({
    '&::before': {
      borderBottomColor: theme.vars.palette.shared.inputUnderline,
    },
    '&::after': {
      borderBottomColor: theme.vars.palette.text.primary,
    },
  }),
};

const MuiInput: Components<Theme>['MuiInput'] = {
  styleOverrides: {
    root: ({ theme }) => inputStyles.root(theme),
  },
};

// ➤ OutlinedInput
export const outlinedInputStyles = {
  root: (theme: Theme, classes: Partial<OutlinedInputClasses>): CSSObject => ({
    [`&.${classes.focused}:not(.${classes.error})`]: {
      [`& .${classes.notchedOutline}`]: {
        borderColor: theme.vars.palette.text.primary,
      },
    },
    [`&.${classes.disabled}`]: {
      [`& .${classes.notchedOutline}`]: {
        borderColor: theme.vars.palette.action.disabledBackground,
      },
    },
  }),
  notchedOutline: (theme: Theme): CSSObject => ({
    borderColor: theme.vars.palette.shared.inputOutlined,
    transition: theme.transitions.create(['border-color'], {
      duration: theme.transitions.duration.shortest,
    }),
  }),
};

export const outlinedInputVariants = {
  root: [
    {
      props: (props) => !!props.multiline,
      style: { ...INPUT_PADDING.outlined.medium },
    },
    {
      props: (props) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.outlined.small },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.outlined.medium },
    },
    {
      props: ({ size }: InputSizeProps) => size === 'small',
      style: { ...INPUT_PADDING.outlined.small },
    },
  ],
} satisfies {
  root: OutlinedInputVariants;
  input: OutlinedInputVariants;
};

const MuiOutlinedInput: Components<Theme>['MuiOutlinedInput'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      ...outlinedInputStyles.root(theme, outlinedInputClasses),
      variants: outlinedInputVariants.root,
    }),
    input: { variants: [...outlinedInputVariants.input, ...multilineInputVariants] },
    notchedOutline: ({ theme }) => outlinedInputStyles.notchedOutline(theme),
  },
};

// ➤ FilledInput
export const filledInputStyles = {
  root: (theme: Theme, classes: Partial<FilledInputClasses>): CSSObject => {
    const baseBg = varAlpha(theme.vars.palette.grey['500Channel'], 0.08);
    const hoverBg = varAlpha(theme.vars.palette.grey['500Channel'], 0.16);
    const errorBg = varAlpha(theme.vars.palette.error.mainChannel, 0.08);
    const errorHoverBg = varAlpha(theme.vars.palette.error.mainChannel, 0.16);
    const disabledBg = theme.vars.palette.action.disabledBackground;

    return {
      backgroundColor: baseBg,
      borderRadius: theme.shape.borderRadius,
      [`&:hover, &.${classes.focused}`]: { backgroundColor: hoverBg },
      [`&.${classes.error}`]: {
        backgroundColor: errorBg,
        [`&:hover, &.${classes.focused}`]: { backgroundColor: errorHoverBg },
      },
      [`&.${classes.disabled}`]: { backgroundColor: disabledBg },
    };
  },
};

export const filledInputVariants = {
  root: [
    {
      props: (props) => !!props.multiline,
      style: { ...INPUT_PADDING.filled.medium },
    },
    {
      props: (props) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.filled.small },
    },
    {
      props: (props) => !!props.multiline && !!props.hiddenLabel,
      style: { ...INPUT_PADDING.filled.mediumHidden },
    },
    {
      props: (props) => !!props.multiline && !!props.hiddenLabel && props.size === 'small',
      style: { ...INPUT_PADDING.filled.smallHidden },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.filled.medium },
    },
    {
      props: ({ size }: InputSizeProps) => size === 'small',
      style: { ...INPUT_PADDING.filled.small },
    },
    {
      props: ({ hiddenLabel }: InputSizeProps) => !!hiddenLabel,
      style: { ...INPUT_PADDING.filled.mediumHidden },
    },
    {
      props: ({ size, hiddenLabel }: InputSizeProps) => !!hiddenLabel && size === 'small',
      style: { ...INPUT_PADDING.filled.smallHidden },
    },
  ],
} satisfies {
  root: FilledInputVariants;
  input: FilledInputVariants;
};

const MuiFilledInput: Components<Theme>['MuiFilledInput'] = {
  defaultProps: {
    disableUnderline: true,
  },
  styleOverrides: {
    root: ({ theme }) => ({
      ...filledInputStyles.root(theme, filledInputClasses),
      variants: filledInputVariants.root,
    }),
    input: {
      variants: [...filledInputVariants.input, ...multilineInputVariants],
    },
  },
};

// ➤ TextField
const MuiTextField: Components<Theme>['MuiTextField'] = {
  defaultProps: {
    variant: 'outlined',
  },
};

export const textField: Components<Theme> = {
  MuiInput,
  MuiInputBase,
  MuiTextField,
  MuiFilledInput,
  MuiOutlinedInput,
};
