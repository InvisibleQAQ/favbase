import type { NavListProps, NavSubListProps } from '../types';

import { useId, useRef, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

import { NavItem } from './nav-item';
import { navSectionClasses } from '../styles';
import { isNavItemActive } from '../nav-active';
import { NavUl, NavLi, NavDropdown, NavDropdownPaper } from '../components';

/**
 * One mini-rail tile plus its flyout (Minimal `mini/nav-list.tsx`).
 *
 * favbase additions:
 * - the flyout never steals focus on hover (`disableAutoFocus` and friends);
 *   Minimal's Popover pulls focus into the paper as the pointer passes by.
 * - `ArrowRight` opens it from the keyboard and moves focus to the first link;
 *   `Escape` closes and hands focus back to the tile. Minimal is hover-only,
 *   which leaves the platform list unreachable without a mouse.
 */
export function NavList({ data, depth, cssVars, slotProps }: NavListProps) {
  const { pathname } = useLocation();

  const anchorRef = useRef<HTMLLIElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const openedByKeyboard = useRef(false);
  const [open, setOpen] = useState(false);

  const hasChild = !!data.children?.length;
  const isActive = isNavItemActive(pathname, data.path, data.deepMatch ?? hasChild);

  const popoverId = useId();
  const dropdownId = open ? popoverId : undefined;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const onOpen = useCallback(() => {
    if (hasChild) setOpen(true);
  }, [hasChild]);

  const onClose = useCallback(() => setOpen(false), []);

  const focusTile = useCallback(() => {
    anchorRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!hasChild) return;

      if (event.key === 'ArrowRight' && !open) {
        event.preventDefault();
        openedByKeyboard.current = true;
        setOpen(true);
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        focusTile();
      }
    },
    [focusTile, hasChild, open],
  );

  const handleEntered = useCallback(() => {
    if (!openedByKeyboard.current) return;
    openedByKeyboard.current = false;
    paperRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, []);

  return (
    <NavLi
      ref={anchorRef}
      disabled={data.disabled}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onKeyDown={handleKeyDown}
    >
      <NavItem
        aria-describedby={dropdownId}
        aria-haspopup={hasChild || undefined}
        aria-expanded={hasChild ? open : undefined}
        path={data.path}
        icon={data.icon}
        info={data.info}
        title={data.title}
        caption={data.caption}
        platform={data.platform}
        external={data.external}
        // state
        open={open}
        active={isActive}
        disabled={data.disabled}
        // options
        depth={depth}
        hasChild={hasChild}
        slotProps={depth === 1 ? slotProps?.rootItem : slotProps?.subItem}
      />

      {hasChild && (
        <NavDropdown
          disableScrollLock
          disableAutoFocus
          disableEnforceFocus
          disableRestoreFocus
          id={dropdownId}
          open={open}
          anchorEl={anchorRef.current}
          onClose={onClose}
          anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
          transformOrigin={{ vertical: 'center', horizontal: 'left' }}
          slotProps={{
            paper: {
              onMouseEnter: onOpen,
              onMouseLeave: onClose,
              className: navSectionClasses.dropdown.root,
            },
            transition: { onEntered: handleEntered },
          }}
          sx={{ ...cssVars }}
        >
          <NavDropdownPaper
            ref={paperRef}
            className={navSectionClasses.dropdown.paper}
            sx={slotProps?.dropdown?.paper}
          >
            <NavSubList
              data={data.children!}
              depth={depth}
              cssVars={cssVars}
              slotProps={slotProps}
            />
          </NavDropdownPaper>
        </NavDropdown>
      )}
    </NavLi>
  );
}

function NavSubList({ data, depth = 0, cssVars, slotProps }: NavSubListProps) {
  return (
    <NavUl sx={{ gap: 0.5 }}>
      {data.map((list) => (
        <NavList
          key={list.title}
          data={list}
          depth={depth + 1}
          cssVars={cssVars}
          slotProps={slotProps}
        />
      ))}
    </NavUl>
  );
}
