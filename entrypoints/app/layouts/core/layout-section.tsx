import type { Theme, SxProps, CSSObject, Breakpoint } from '@mui/material/styles';

import { styled } from '@mui/material/styles';
import GlobalStyles from '@mui/material/GlobalStyles';

import { layoutClasses } from './classes';
import { layoutSectionVars } from './css-vars';

export type LayoutSectionProps = React.ComponentProps<'div'> & {
  sx?: SxProps<Theme>;
  cssVars?: CSSObject;
  /** Breakpoint at which the Header switches to its desktop height. */
  layoutQuery?: Breakpoint;
  children?: React.ReactNode;
  footerSection?: React.ReactNode;
  headerSection?: React.ReactNode;
  sidebarSection?: React.ReactNode;
};

/**
 * Scroll ownership: the document is the only page scroll container. The
 * sidebar is `position: fixed` and scrolls its own list; the Header is
 * `position: sticky` inside the sidebar container; `<main>` simply flows.
 * Layout CSS vars live on `:root` so `html`'s `scroll-padding-top` can read
 * the Header height and keep focus/anchor scrolling from landing under the
 * sticky Header.
 */
export function LayoutSection({
  sx,
  cssVars,
  children,
  footerSection,
  headerSection,
  sidebarSection,
  className,
  layoutQuery = 'md',
  ...other
}: LayoutSectionProps) {
  const inputGlobalStyles = (
    <GlobalStyles
      styles={(theme) => ({
        ':root': { ...layoutSectionVars(theme), ...cssVars },
        html: {
          scrollPaddingTop: 'var(--layout-header-mobile-height)',
          [theme.breakpoints.up(layoutQuery)]: {
            scrollPaddingTop: 'var(--layout-header-desktop-height)',
          },
        },
      })}
    />
  );

  return (
    <>
      {inputGlobalStyles}

      <LayoutRoot
        id="root__layout"
        className={[layoutClasses.root, className].filter(Boolean).join(' ')}
        sx={sx}
        {...other}
      >
        {sidebarSection ? (
          <>
            {sidebarSection}
            <LayoutSidebarContainer className={layoutClasses.sidebarContainer}>
              {headerSection}
              {children}
              {footerSection}
            </LayoutSidebarContainer>
          </>
        ) : (
          <>
            {headerSection}
            {children}
            {footerSection}
          </>
        )}
      </LayoutRoot>
    </>
  );
}

const LayoutRoot = styled('div')``;

const LayoutSidebarContainer = styled('div')(() => ({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  // A flex child defaults to min-width:auto; wide content would then push the
  // page into horizontal scroll instead of letting the content area shrink.
  minWidth: 0,
}));
