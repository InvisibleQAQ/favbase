import type { Theme, Components } from '@mui/material/styles';

const MuiPaper: Components<Theme>['MuiPaper'] = {
  defaultProps: {
    elevation: 0,
  },
  styleOverrides: {
    root: {
      backgroundImage: 'none',
      variants: [
        {
          props: (props) => props.variant === 'outlined',
          style: ({ theme }) => ({
            borderColor: theme.vars.palette.shared.paperOutlined,
          }),
        },
      ],
    },
  },
};

export const paper: Components<Theme> = {
  MuiPaper,
};
