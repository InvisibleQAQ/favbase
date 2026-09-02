import type { CSSObject } from '@mui/material/styles';

import { styled } from '@mui/material/styles';
import Popover, { popoverClasses } from '@mui/material/Popover';

/**
 * Mini-rail flyout (Minimal `nav-dropdown.tsx`): the Popover paper is made
 * transparent and non-interactive so the visible surface is `NavDropdownPaper`,
 * which can keep the `paperStyles(dropdown)` radius and shadow while the outer
 * paper provides the hover-safe gutter between rail and menu.
 */
export const NavDropdownPaper = styled('div')(({ theme }) => ({
  minWidth: 180,
  ...theme.mixins.paperStyles(theme, { dropdown: true }),
}));

export const NavDropdown = styled(Popover)(({ open, theme }) => ({
  pointerEvents: 'none',
  [`& .${popoverClasses.paper}`]: {
    boxShadow: 'none',
    overflow: 'unset',
    backdropFilter: 'none',
    background: 'transparent',
    padding: theme.spacing(0, 0.75),
    ...(open && { pointerEvents: 'auto' }),
  } as CSSObject,
}));
