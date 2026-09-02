import type { Theme, SxProps } from '@mui/material/styles';
import type { PaperOffset, ArrowPlacement, CustomPopoverProps } from './types';

import { useState, useCallback } from 'react';

import Popover from '@mui/material/Popover';
import { useTheme } from '@mui/material/styles';
import { listClasses } from '@mui/material/List';
import { menuItemClasses } from '@mui/material/MenuItem';

import { useElementRect } from './hooks';
import { getPopoverOrigin } from './utils';
import { Arrow, getPaperOffsetStyles } from './styles';

const DEFAULT_ARROW_SIZE: number = 14;
const DEFAULT_ARROW_PLACEMENT: ArrowPlacement = 'top-right';
const DEFAULT_PAPER_OFFSET: PaperOffset = [8, 2];

/**
 * Popover that points at its anchor. `slotProps.arrow.placement` picks one of
 * twelve positions and drives the anchor/transform origins with it, so callers
 * state the intent once instead of keeping two origin objects in sync.
 */
export function CustomPopover({
  open,
  onClose,
  children,
  anchorEl,
  slotProps,
  ...other
}: CustomPopoverProps) {
  const theme = useTheme();
  const isRtl = theme.direction === 'rtl';

  const { arrow: arrowProps, paper: paperProps, ...otherSlotProps } = slotProps ?? {};

  const arrowSize = arrowProps?.size ?? DEFAULT_ARROW_SIZE;
  const arrowPlacement = arrowProps?.placement ?? DEFAULT_ARROW_PLACEMENT;
  const paperOffset = paperProps?.offset ?? DEFAULT_PAPER_OFFSET;

  const { anchorOrigin, transformOrigin } = getPopoverOrigin(arrowPlacement, isRtl);

  // MUI v9 does not forward `slotProps.paper.ref` to the paper node, so the
  // arrow finds its own host instead: it is the paper's first child, so its
  // parentElement is the paper. Minimal's ref-based version silently produced
  // no arrow at all under v9.
  const [paperEl, setPaperEl] = useState<HTMLElement | null>(null);
  const handleArrowRef = useCallback((node: HTMLSpanElement | null) => {
    setPaperEl(node?.parentElement ?? null);
  }, []);

  const paperRect = useElementRect(paperEl, 'popoverPaper', !!open);
  const anchorRect = useElementRect(anchorEl as HTMLElement, 'anchor', !!open);

  const paperStyles: SxProps<Theme> = {
    ...getPaperOffsetStyles(arrowPlacement, paperOffset, isRtl),
    overflow: 'inherit',
    [`& .${listClasses.root}`]: { minWidth: 140 },
    [`& .${menuItemClasses.root}`]: { gap: 2 },
  };

  return (
    <Popover
      aria-hidden={!open}
      open={!!open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        ...otherSlotProps,
        paper: {
          ...paperProps,
          sx: [paperStyles, ...(Array.isArray(paperProps?.sx) ? paperProps.sx : [paperProps?.sx])],
        },
      }}
      {...other}
    >
      {!arrowProps?.hide && (
        <Arrow
          ref={handleArrowRef}
          size={arrowSize}
          placement={arrowPlacement}
          paperRect={paperRect}
          anchorRect={anchorRect}
          sx={arrowProps?.sx}
        />
      )}

      {children}
    </Popover>
  );
}
