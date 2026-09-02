import type { NavListProps, NavSubListProps } from '../types';

import { useId, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

import { NavItem } from './nav-item';
import { navSectionClasses } from '../styles';
import { isNavItemActive } from '../nav-active';
import { NavUl, NavLi, NavCollapse } from '../components';

/**
 * One row plus its collapse (Minimal `vertical/nav-list.tsx`).
 *
 * favbase deviations:
 * - the open state is not tied back to the route on the way out. Minimal
 *   collapses a branch as soon as the route leaves it; Favbase keeps the tree
 *   the user (or the route) opened, so leaving `/collections/*` no longer hides
 *   the platform list.
 * - the toggle is the disclosure button's `onClick`, not the row's (D15).
 */
export function NavList({ data, depth, slotProps }: NavListProps) {
  const { pathname } = useLocation();
  const submenuId = useId();

  const hasChild = !!data.children?.length;
  const isActive = isNavItemActive(pathname, data.path, data.deepMatch ?? hasChild);

  const [open, setOpen] = useState(isActive && hasChild);

  useEffect(() => {
    if (isActive && hasChild) setOpen(true);
  }, [isActive, hasChild]);

  const onToggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <NavLi
      disabled={data.disabled}
      sx={{
        ...(hasChild && {
          [`& .${navSectionClasses.li}`]: {
            '&:first-of-type': { mt: 'var(--nav-item-gap)' },
          },
        }),
      }}
    >
      <NavItem
        path={data.path}
        icon={data.icon}
        info={data.info}
        title={data.title}
        caption={data.caption}
        platform={data.platform}
        external={data.external}
        toggleLabel={data.toggleLabel}
        // state
        open={open}
        active={isActive}
        disabled={data.disabled}
        // options
        depth={depth}
        hasChild={hasChild}
        slotProps={depth === 1 ? slotProps?.rootItem : slotProps?.subItem}
        // disclosure
        submenuId={submenuId}
        onToggle={onToggle}
      />

      {hasChild && (
        <NavCollapse id={submenuId} mountOnEnter unmountOnExit depth={depth} in={open}>
          <NavSubList data={data.children!} depth={depth} slotProps={slotProps} />
        </NavCollapse>
      )}
    </NavLi>
  );
}

function NavSubList({ data, depth = 0, slotProps }: NavSubListProps) {
  return (
    <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
      {data.map((list) => (
        <NavList key={list.title} data={list} depth={depth + 1} slotProps={slotProps} />
      ))}
    </NavUl>
  );
}
