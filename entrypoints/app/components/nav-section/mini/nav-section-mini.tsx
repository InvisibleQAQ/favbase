import type { NavGroupProps, NavSectionProps } from '../types';

import { mergeClasses } from 'minimal-shared/utils';

import { useTheme } from '@mui/material/styles';

import { NavList } from './nav-list';
import { Nav, NavUl, NavLi } from '../components';
import { navSectionClasses, navSectionCssVars } from '../styles';

/**
 * Collapsed rail nav (Minimal `mini/nav-section-mini.tsx`). Group subheaders
 * are dropped at this width — the groups stay in DOM order, unlabelled.
 */
export function NavSectionMini({
  sx,
  data,
  className,
  slotProps,
  cssVars: overridesVars,
  ...other
}: NavSectionProps) {
  const theme = useTheme();

  const cssVars = { ...navSectionCssVars.mini(theme), ...overridesVars };

  return (
    <Nav
      className={mergeClasses([navSectionClasses.mini, className])}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl sx={{ flex: '1 1 auto', gap: 'var(--nav-item-gap)' }}>
        {data.map((group) => (
          <Group
            key={group.subheader ?? group.items[0].title}
            items={group.items}
            cssVars={cssVars}
            slotProps={slotProps}
          />
        ))}
      </NavUl>
    </Nav>
  );
}

function Group({ items, cssVars, slotProps }: NavGroupProps) {
  return (
    <NavLi>
      <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
        {items.map((list) => (
          <NavList
            key={list.title}
            depth={1}
            data={list}
            cssVars={cssVars}
            slotProps={slotProps}
          />
        ))}
      </NavUl>
    </NavLi>
  );
}
