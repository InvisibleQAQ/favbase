import type { Theme, Components } from '@mui/material/styles';

import { formLabelClasses } from '@mui/material/FormLabel';
import { inputLabelClasses } from '@mui/material/InputLabel';

import { INPUT_PADDING, getInputTypography } from './text-field';

const MuiFormControl: Components<Theme>['MuiFormControl'] = {
  defaultProps: {
    variant: 'outlined',
  },
};

/** Label styles for TextField and Select; resting offsets derive from `INPUT_PADDING`. */
const MuiInputLabel: Components<Theme>['MuiInputLabel'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      variants: [
        {
          props: (props) => !props.shrink,
          style: {
            ...getInputTypography(theme, ['fontSize', 'lineHeight']),
            color: theme.vars.palette.text.disabled,
          },
        },
        {
          props: (props) => !!props.shrink,
          style: {
            fontWeight: theme.typography.fontWeightSemiBold,
            [`&.${inputLabelClasses.focused}:not(.${inputLabelClasses.error})`]: {
              color: 'inherit',
            },
          },
        },
        {
          props: (props) => !props.shrink && props.variant === 'outlined' && props.size === 'small',
          style: {
            transform: `translate(14px, ${INPUT_PADDING.outlined.small.paddingTop}px) scale(1)`,
          },
        },
        {
          props: (props) =>
            !props.shrink && props.variant === 'outlined' && props.size === 'medium',
          style: {
            transform: `translate(14px, ${INPUT_PADDING.outlined.medium.paddingTop}px) scale(1)`,
          },
        },
        {
          props: (props) => !!props.shrink && props.variant === 'filled' && props.size === 'medium',
          style: {
            transform: 'translate(12px, 6px) scale(0.75)',
          },
        },
      ],
    }),
  },
};

/** Label styles for Checkbox, RadioGroup, Switch. */
const MuiFormLabel: Components<Theme>['MuiFormLabel'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      [`&.${formLabelClasses.disabled}`]: {
        color: theme.vars.palette.action.disabled,
      },
      variants: [
        {
          props: (props) => !props.error,
          style: {
            [`&.${formLabelClasses.focused}`]: {
              color: theme.vars.palette.text.secondary,
            },
          },
        },
      ],
    }),
  },
};

const MuiFormControlLabel: Components<Theme>['MuiFormControlLabel'] = {
  styleOverrides: {
    label: ({ theme }) => ({
      ...theme.typography.body2,
    }),
  },
};

const MuiFormHelperText: Components<Theme>['MuiFormHelperText'] = {
  defaultProps: {
    component: 'div',
  },
  styleOverrides: {
    root: ({ theme }) => ({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      margin: theme.spacing(0.75, 1.5, 0, 1.5),
      '& > svg': { width: 16, height: 16 },
    }),
  },
};

export const form: Components<Theme> = {
  MuiFormLabel,
  MuiInputLabel,
  MuiFormControl,
  MuiFormHelperText,
  MuiFormControlLabel,
};
