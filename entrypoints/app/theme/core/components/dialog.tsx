import type { Theme, Components } from '@mui/material/styles';

/**
 * Minimal dialog rhythm (24px title/actions, 0/24 content, 16px radius).
 * favbase overrides, marked inline, are functional rather than visual: every
 * `<Dialog>` in app.html relies on the full-width `sm` default, the paper is
 * viewport-bounded, and actions wrap on narrow screens instead of overflowing.
 */
const MuiDialog: Components<Theme>['MuiDialog'] = {
  // favbase override: both dialogs (WebDAV clear-remote confirm, host permission
  // recovery) pass no size props and expect this shape.
  defaultProps: { fullWidth: true, maxWidth: 'sm' },
  styleOverrides: {
    paper: {
      variants: [
        {
          props: (props) => !props.fullScreen,
          style: ({ theme }) => ({
            margin: theme.spacing(2),
            boxShadow: theme.vars.customShadows.dialog,
            borderRadius: Number(theme.shape.borderRadius) * 2,
            // favbase override: 16px gutters on every side of the viewport.
            width: `calc(100% - ${theme.spacing(4)})`,
            maxHeight: `calc(100dvh - ${theme.spacing(4)})`,
          }),
        },
      ],
    },
  },
};

const MuiDialogTitle: Components<Theme>['MuiDialogTitle'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(3),
    }),
  },
};

const MuiDialogContent: Components<Theme>['MuiDialogContent'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(0, 3),
    }),
    dividers: ({ theme }) => ({
      borderTop: 0,
      borderBottomStyle: 'dashed',
      paddingBottom: theme.spacing(3),
    }),
  },
};

const MuiDialogActions: Components<Theme>['MuiDialogActions'] = {
  defaultProps: {
    disableSpacing: true,
  },
  styleOverrides: {
    root: ({ theme }) => ({
      padding: theme.spacing(3),
      // favbase override: flex gap instead of Minimal's sibling margin so the
      // action row wraps on narrow screens.
      gap: theme.spacing(1.5),
      flexWrap: 'wrap',
    }),
  },
};

export const dialog: Components<Theme> = {
  MuiDialog,
  MuiDialogTitle,
  MuiDialogContent,
  MuiDialogActions,
};
