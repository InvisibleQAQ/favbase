import type { NavSectionProps } from '../../components/nav-section';

import { useRef, useEffect } from 'react';
import { mergeClasses } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';

import { useLocation } from 'react-router-dom';

import { Scrollbar } from '../../components/scrollbar';
import { NavSectionVertical } from '../../components/nav-section';

import { layoutClasses } from '../core/classes';

export type NavMobileProps = NavSectionProps & {
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
};

/**
 * Temporary Drawer below `layoutQuery` (Minimal `nav-mobile.tsx`), always in
 * the expanded shape.
 *
 * The focus contract is Favbase's and unchanged from the pre-Step-4 `NavMobile`
 * — the MUI 9 + React 19 ordering shared with the Chat history drawer:
 * `disableRestoreFocus` plus blurring the focused descendant in
 * `onTransitionExited`, then handing focus back to the trigger from the
 * transition's `onExited`. Never touch `aria-hidden` by hand.
 */
export function NavMobile({ sx, data, open, onClose, onExited, className, ...other }: NavMobileProps) {
  const { pathname } = useLocation();
  const paperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer
      open={open}
      onClose={onClose}
      ModalProps={{
        disableRestoreFocus: true,
        onTransitionExited: () => {
          // Runs before ModalManager hides the modal; release its focused descendant first.
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement && paperRef.current?.contains(activeElement)) {
            activeElement.blur();
          }
        },
      }}
      slotProps={{
        transition: { onExited },
        paper: {
          ref: paperRef,
          className: mergeClasses([layoutClasses.nav.root, layoutClasses.nav.vertical, className]),
          sx: [
            {
              overflow: 'unset',
              bgcolor: 'background.default',
              width: 'var(--layout-nav-mobile-width)',
            },
            ...(Array.isArray(sx) ? sx : [sx]),
          ],
        },
      }}
    >
      <Box sx={{ pt: 2.5, pb: 1, pl: 2.75, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          component="img"
          src="/icon/128.png"
          alt=""
          sx={{ width: 36, height: 36, borderRadius: 0.5, flexShrink: 0 }}
        />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          favbase
        </Typography>
      </Box>

      <Scrollbar fillContent>
        <NavSectionVertical data={data} sx={{ px: 2, pb: 2, flex: '1 1 auto' }} {...other} />
      </Scrollbar>
    </Drawer>
  );
}
