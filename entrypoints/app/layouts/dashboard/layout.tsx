import type { Breakpoint } from '@mui/material/styles';

import { useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import IconButton from '@mui/material/IconButton';

import { sidebarPinnedStorage } from '@/lib/storage';

import { Iconify } from '../../components/iconify';

import { NavMobile, NavDesktop } from './nav';
import { HeaderActions } from './header-actions';
import { useJobsBadge } from '../../hooks/use-jobs-badge';
import { BackgroundJobsIndicator } from './background-jobs-indicator';
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
  layoutQuery = 'md',
}: DashboardLayoutProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up(layoutQuery));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(true);

  // Toolbar badge = running-job count; always mounted like the indicator chip.
  useJobsBadge();

  useEffect(() => {
    let cancelled = false;
    sidebarPinnedStorage.getValue().then((v) => {
      if (!cancelled) setPinned(v);
    });
    const unwatch = sidebarPinnedStorage.watch((newVal) => {
      setPinned(newVal);
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      sidebarPinnedStorage.setValue(next);
      return next;
    });
  }, []);

  const renderHeader = () => (
    <HeaderSection
      disableElevation
      layoutQuery={layoutQuery}
      slots={{
        leftArea: (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {!isDesktop && (
              <IconButton
                onClick={(e) => {
                  (e.currentTarget as HTMLElement).blur();
                  setMobileOpen(true);
                }}
                sx={{ mr: 1, ml: -1 }}
              >
                <Iconify icon="custom:menu-duotone" />
              </IconButton>
            )}
            {isDesktop && (
              <IconButton onClick={togglePinned} sx={{ mr: 1, ml: -1 }}>
                <Iconify icon="solar:siderbar-bold-duotone" />
              </IconButton>
            )}
          </Box>
        ),
        rightArea: (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
            <BackgroundJobsIndicator />
            <HeaderActions />
          </Box>
        ),
      }}
    />
  );

  return (
    <LayoutSection
      headerSection={renderHeader()}
      sidebarSection={
        <>
          <NavDesktop data={navData} layoutQuery={layoutQuery} pinned={pinned} />
          <NavMobile
            data={navData}
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
          />
        </>
      }
      footerSection={null}
      cssVars={{ ...dashboardLayoutVars(theme, pinned), ...cssVars }}
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
