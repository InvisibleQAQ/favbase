import { useRef, type RefObject } from 'react';

import Drawer from '@mui/material/Drawer';

import { ChatNav, type ChatNavProps } from './chat-nav';
import { CHAT_NAV_WIDTH } from './layout';

interface ChatNavDrawerProps extends Omit<ChatNavProps, 'variant' | 'collapse' | 'onToggleCollapse'> {
  open: boolean;
  /** The visible trigger to hand focus back to, unless it has itself gone away. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  canRestoreFocus: boolean;
  onClose: () => void;
}

/**
 * Mobile history Drawer. Keeps the exit-focus contract (`ui-design-system.md`
 * §12): explicit refs, `disableRestoreFocus` paired with explicit restoration,
 * blur the focused descendant before the modal is hidden, restore the trigger
 * from the transition's `onExited`, and never touch `aria-hidden`/`inert`.
 */
export function ChatNavDrawer({
  open,
  triggerRef,
  canRestoreFocus,
  onClose,
  ...navProps
}: ChatNavDrawerProps) {
  const paperRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      ModalProps={{
        disableRestoreFocus: true,
        onTransitionExited: () => {
          // Runs before ModalManager hides the modal; release its focused
          // descendant first.
          const activeElement = document.activeElement;
          if (activeElement instanceof HTMLElement && paperRef.current?.contains(activeElement)) {
            activeElement.blur();
          }
        },
      }}
      sx={{ display: { lg: 'none' }, zIndex: 'calc(var(--layout-nav-zIndex) + 1)' }}
      slotProps={{
        transition: {
          onExited: () => {
            // Slide calls this after ModalManager has removed #root's aria-hidden.
            if (canRestoreFocus) triggerRef.current?.focus();
          },
        },
        paper: {
          ref: paperRef,
          sx: {
            left: { xs: 0, md: 'var(--layout-nav-vertical-width)' },
            width: `min(${CHAT_NAV_WIDTH}px, calc(100vw - 32px))`,
            p: 0,
          },
        },
      }}
    >
      <ChatNav variant="drawer" onClose={onClose} {...navProps} />
    </Drawer>
  );
}
