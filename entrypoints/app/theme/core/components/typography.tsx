import type { Theme, Components } from '@mui/material/styles';

// favbase override: Minimal has no Typography entry. Card titles and
// sub-captions are not section headings — one page, one h1 — so the subtitle
// variants render as paragraphs and the heading outline stays test-locked.
const MuiTypography: Components<Theme>['MuiTypography'] = {
  defaultProps: {
    variantMapping: { subtitle1: 'p', subtitle2: 'p' },
  },
};

export const typography: Components<Theme> = {
  MuiTypography,
};
