import type { Breakpoint } from '@mui/material/styles';
import type { ContainerProps } from '@mui/material/Container';

import Container from '@mui/material/Container';

import { layoutClasses } from '../core/classes';

/**
 * Breakpoint from which the dashboard content (and the Header, which aligns
 * with it) uses the 40px desktop gutter. Below it MUI Container's own gutters
 * apply: 24px from `sm`, 16px at `xs`.
 */
export const DASHBOARD_CONTENT_QUERY: Breakpoint = 'lg';

export type DashboardContentProps = ContainerProps & {
  layoutQuery?: Breakpoint;
  disablePadding?: boolean;
};

export function DashboardContent({
  sx,
  children,
  className,
  disablePadding,
  maxWidth = 'lg',
  layoutQuery = DASHBOARD_CONTENT_QUERY,
  ...other
}: DashboardContentProps) {
  return (
    <Container
      className={[layoutClasses.content, className].filter(Boolean).join(' ')}
      maxWidth={maxWidth}
      sx={[
        (theme) => ({
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          pt: 'var(--layout-dashboard-content-pt)',
          pb: 'var(--layout-dashboard-content-pb)',
          [theme.breakpoints.up(layoutQuery)]: {
            px: 'var(--layout-dashboard-content-px)',
          },
          ...(disablePadding && { p: { xs: 0, sm: 0, md: 0, lg: 0, xl: 0 } }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {children}
    </Container>
  );
}
