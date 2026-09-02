import type { ListSubheaderProps } from '@mui/material/ListSubheader';

import { mergeClasses } from 'minimal-shared/utils';

import { styled } from '@mui/material/styles';
import ListSubheader from '@mui/material/ListSubheader';

import { navSectionClasses } from '../styles';

/**
 * Group label (Minimal `nav-subheader.tsx`), with its click-to-collapse
 * behaviour dropped: Favbase has two groups of one and three items, so a
 * collapse control would add a fake button (Minimal ships a `div` with an
 * `onClick` and no keyboard path) to the nav's tab order for no product value.
 * Purely a label here — the typography, spacing and `text.disabled` ink are
 * Minimal's.
 */
export const NavSubheader = styled(({ className, ...other }: ListSubheaderProps) => (
  <ListSubheader
    disableSticky
    disableGutters
    component="div"
    {...other}
    className={mergeClasses([navSectionClasses.subheader, className])}
  />
))(({ theme }) => ({
  ...theme.typography.overline,
  alignItems: 'center',
  display: 'inline-flex',
  alignSelf: 'flex-start',
  color: 'var(--nav-subheader-color)',
  padding: theme.spacing(2, 1, 1, 1.5),
  fontSize: theme.typography.pxToRem(11),
  backgroundColor: 'transparent',
}));
