import type { CSSObject } from '@mui/material/styles';

import { styled } from '@mui/material/styles';
import Collapse from '@mui/material/Collapse';

import { navSectionClasses } from '../styles';

/**
 * Sub-list container (Minimal `nav-collapse.tsx`). It owns the tree connector's
 * vertical spine: a 2px line under the parent icon's midline that stops half a
 * bullet short of the last row, so the last leaf's bullet closes the run as an
 * L-corner. The per-row bullets are drawn by the sub-item itself.
 */
export const NavCollapse = styled(Collapse, {
  shouldForwardProp: (prop: string) => !['depth', 'sx'].includes(prop),
})<{ depth?: number }>(({ depth }) => {
  const verticalLineStyles: CSSObject = {
    top: 0,
    left: 0,
    width: '2px',
    content: '""',
    position: 'absolute',
    backgroundColor: 'var(--nav-bullet-color)',
    bottom: 'calc(var(--nav-item-sub-height) - 2px - var(--nav-bullet-size) / 2)',
  };

  return {
    ...(depth && {
      paddingLeft: 'calc(var(--nav-item-pl) + var(--nav-icon-size) / 2)',
      [`& .${navSectionClasses.ul}`]: {
        position: 'relative',
        paddingLeft: 'var(--nav-bullet-size)',
        '&::before': verticalLineStyles,
      },
    }),
  };
});
