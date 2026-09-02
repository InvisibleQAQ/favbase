import type { NavGroupProps, NavSectionProps } from '../types';

import { mergeClasses } from 'minimal-shared/utils';

import { useTheme } from '@mui/material/styles';

import { NavList } from './nav-list';
import { Nav, NavUl, NavLi, NavSubheader } from '../components';
import { navSectionClasses, navSectionCssVars } from '../styles';

/** Expanded rail nav (Minimal `vertical/nav-section-vertical.tsx`). */
export function NavSectionVertical({
  sx,
  data,
  className,
  slotProps,
  cssVars: overridesVars,
  ...other
}: NavSectionProps) {
  const theme = useTheme();

  const cssVars = { ...navSectionCssVars.vertical(theme), ...overridesVars };

  return (
    <Nav
      className={mergeClasses([navSectionClasses.vertical, className])}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl sx={{ flex: '1 1 auto', gap: 'var(--nav-item-gap)' }}>
        {data.map((group) => (
          <Group
            key={group.subheader ?? group.items[0].title}
            subheader={group.subheader}
            items={group.items}
            slotProps={slotProps}
          />
        ))}
      </NavUl>
    </Nav>
  );
}

function Group({ items, subheader, slotProps }: NavGroupProps) {
  return (
    <NavLi>
      {subheader && <NavSubheader sx={slotProps?.subheader}>{subheader}</NavSubheader>}

      <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
        {items.map((list) => (
          <NavList key={list.title} data={list} depth={1} slotProps={slotProps} />
        ))}
      </NavUl>
    </NavLi>
  );
}
