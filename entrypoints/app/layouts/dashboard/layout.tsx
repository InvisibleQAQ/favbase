import type { Breakpoint } from '@mui/material/styles';

import { useState } from 'react';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';

import { Iconify } from '../../components/iconify';

import { NavMobile, NavDesktop } from './nav';
import { layoutClasses } from '../core/classes';
import { dashboardLayoutVars } from './css-vars';
import { navData } from '../nav-config';
import { MainSection } from '../core/main-section';
import { HeaderSection } from '../core/header-section';
import { LayoutSection } from '../core/layout-section';

import type { LayoutSectionProps } from '../core/layout-section';

type LayoutBaseProps = Pick<LayoutSectionProps, 'sx' | 'children' | 'cssVars'>;

export type DashboardLayoutProps = LayoutBaseProps & {
  layoutQuery?: Breakpoint;
};

export function DashboardLayout({
  sx,
  cssVars,
  children,
  layoutQuery = 'lg',
}: DashboardLayoutProps) {
  const theme = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const renderHeader = () => (
    <HeaderSection
      disableElevation
      layoutQuery={layoutQuery}
      slots={{
        leftArea: (
          <IconButton
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1, ml: -1, [theme.breakpoints.up(layoutQuery)]: { display: 'none' } }}
          >
            <Iconify icon="custom:menu-duotone" />
          </IconButton>
        ),
        rightArea: (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.75 } }} />
        ),
      }}
    />
  );

  return (
    <LayoutSection
      headerSection={renderHeader()}
      sidebarSection={
        <>
          <NavDesktop data={navData} layoutQuery={layoutQuery} />
          <NavMobile
            data={navData}
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
          />
        </>
      }
      footerSection={null}
      cssVars={{ ...dashboardLayoutVars(theme), ...cssVars }}
      sx={[
        {
          [`& .${layoutClasses.sidebarContainer}`]: {
            [theme.breakpoints.up(layoutQuery)]: {
              pl: 'var(--layout-nav-vertical-width)',
              transition: theme.transitions.create(['padding-left'], {
                easing: 'var(--layout-transition-easing)',
                duration: 'var(--layout-transition-duration)',
              }),
            },
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <MainSection>{children}</MainSection>
    </LayoutSection>
  );
}
