// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';

import { ThemeProvider } from '../../theme/theme-provider';
import { CustomPopover } from './custom-popover';
import { getArrowOffset, getPopoverOrigin } from './utils';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('CustomPopover placement math', () => {
  it('derives both origins from a single placement', () => {
    // The whole point of the placement prop: callers state the intent once
    // instead of keeping anchorOrigin and transformOrigin in sync by hand.
    expect(getPopoverOrigin('top-right')).toEqual({
      anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
      transformOrigin: { vertical: 'top', horizontal: 'right' },
    });

    expect(getPopoverOrigin('left-center')).toEqual({
      anchorOrigin: { vertical: 'center', horizontal: 'right' },
      transformOrigin: { vertical: 'center', horizontal: 'left' },
    });
  });

  it('mirrors horizontal origins when the layout is right-to-left', () => {
    const { anchorOrigin, transformOrigin } = getPopoverOrigin('top-right', true);

    expect(anchorOrigin.horizontal).toBe('left');
    expect(transformOrigin.horizontal).toBe('left');
    // Vertical placement is unaffected by direction.
    expect(anchorOrigin.vertical).toBe('bottom');
  });

  it('centres the arrow on the anchor and clamps it inside the paper', () => {
    const paper = { top: 0, left: 0, width: 200, height: 100 };

    const centred = getArrowOffset({ top: 0, left: 90, width: 20, height: 20 }, paper, 14);
    expect(centred.offsetX).toBe(93);

    // An anchor hanging off the right edge must not drag the arrow past the
    // paper's corner radius.
    const clamped = getArrowOffset({ top: 0, left: 400, width: 20, height: 20 }, paper, 14);
    expect(clamped.offsetX).toBe(200 - 14 * 2);
  });
});

describe('CustomPopover', () => {
  let container: HTMLDivElement;
  let root: Root;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    anchor = document.createElement('button');
    document.body.append(anchor);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    anchor.remove();
  });

  const render = (node: ReactElement) => {
    act(() => {
      root.render(themed(node));
    });
  };

  it('renders its content in a dialog surface while open', () => {
    render(
      <CustomPopover open anchorEl={anchor} onClose={() => {}}>
        <MenuList>
          <MenuItem>Rename</MenuItem>
        </MenuList>
      </CustomPopover>,
    );

    const paper = document.body.querySelector('.MuiPopover-paper');
    expect(paper).not.toBeNull();
    expect(paper?.textContent).toContain('Rename');
  });

  it('renders nothing while closed', () => {
    render(
      <CustomPopover open={false} anchorEl={anchor} onClose={() => {}}>
        <MenuList>
          <MenuItem>Rename</MenuItem>
        </MenuList>
      </CustomPopover>,
    );

    expect(document.body.querySelector('.MuiPopover-paper')).toBeNull();
  });

  it('grows an arrow inside the paper once both boxes are measured', () => {
    render(
      <CustomPopover open anchorEl={anchor} onClose={() => {}}>
        <MenuList>
          <MenuItem>Rename</MenuItem>
        </MenuList>
      </CustomPopover>,
    );

    const paper = document.body.querySelector('.MuiPopover-paper');
    const arrow = paper?.firstElementChild;
    expect(arrow?.tagName).toBe('SPAN');

    // MUI v9 stopped forwarding slotProps.paper.ref, so the arrow locates the
    // paper through its own parentElement. If that regressed the arrow would
    // stay display:none forever and no one would notice visually.
    const style = getComputedStyle(arrow as Element);
    expect(style.display).not.toBe('none');
    expect(style.position).toBe('absolute');
  });

  it('honours slotProps.arrow.hide', () => {
    render(
      <CustomPopover open anchorEl={anchor} onClose={() => {}} slotProps={{ arrow: { hide: true } }}>
        <MenuList>
          <MenuItem>Rename</MenuItem>
        </MenuList>
      </CustomPopover>,
    );

    const paper = document.body.querySelector('.MuiPopover-paper');
    expect(paper?.firstElementChild?.tagName).not.toBe('SPAN');
  });

  it('closes through the backdrop', () => {
    const onClose = vi.fn();
    render(
      <CustomPopover open anchorEl={anchor} onClose={onClose}>
        <MenuList>
          <MenuItem>Rename</MenuItem>
        </MenuList>
      </CustomPopover>,
    );

    const backdrop = document.body.querySelector('.MuiBackdrop-root, .MuiModal-backdrop');
    act(() => {
      (backdrop as HTMLElement)?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
