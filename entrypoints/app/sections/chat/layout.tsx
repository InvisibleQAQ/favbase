import type { ReactNode, ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import { styled } from '@mui/material/styles';

/**
 * Desktop conversation rail width, and the width it collapses to.
 *
 * Minimal keeps these as module constants in `chat-nav.tsx`, not as CSS
 * variables on the layout root (docs/25 Step 9 erratum E-1): the mobile Drawer
 * renders in a portal and could not read a root-scoped variable anyway.
 */
export const CHAT_NAV_WIDTH = 320;
export const CHAT_NAV_COLLAPSE_WIDTH = 96;

type ChatLayoutProps = Omit<ComponentProps<'section'>, 'children'> & {
  sx?: SxProps<Theme>;
  slots: {
    nav: ReactNode;
    header: ReactNode;
    main: ReactNode;
  };
};

/**
 * Minimal's chat card: a rail column beside a header + main column, all inside
 * one rounded elevated surface. Minimal's fourth slot (`details`, the chat-room
 * member panel) has no Favbase counterpart and is not ported.
 *
 * The root stays the labelled `section` the page contract expects; its height
 * comes from the caller, because the dashboard main area is not itself a
 * height-bounded flex column.
 */
export function ChatLayout({ slots, sx, ...other }: ChatLayoutProps) {
  return (
    <LayoutRoot sx={sx} {...other}>
      <LayoutNav>{slots.nav}</LayoutNav>

      <LayoutContainer>
        {/* `data-slot` is the runtime-verification handle: the history trigger is
            reached through it, not through the h1's parent. */}
        <LayoutHeader data-slot="chat-header">{slots.header}</LayoutHeader>
        <LayoutMain>{slots.main}</LayoutMain>
      </LayoutContainer>
    </LayoutRoot>
  );
}

const LayoutRoot = styled('section')(({ theme }) => ({
  minHeight: 0,
  minWidth: 0,
  flex: '1 1 auto',
  display: 'flex',
  position: 'relative',
  // The rail's right border and the scrolling columns both run to the edge, so
  // the rounded corners have to clip.
  overflow: 'hidden',
  boxShadow: theme.vars.customShadows.card,
  borderRadius: Number(theme.shape.borderRadius) * 2,
  backgroundColor: theme.vars.palette.background.paper,
}));

const LayoutNav = styled('div')(() => ({
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
}));

const LayoutContainer = styled('div')(() => ({
  minWidth: 0,
  minHeight: 0,
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
}));

const LayoutHeader = styled('div')(({ theme }) => ({
  height: 72,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1, 1, 1, 2.5),
  borderBottom: `solid 1px ${theme.vars.palette.divider}`,
}));

const LayoutMain = styled('div')(() => ({
  minWidth: 0,
  minHeight: 0,
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
}));
