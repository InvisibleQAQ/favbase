import type { Breakpoint } from '@mui/material/styles';

import { useRef, useState, useEffect, useCallback } from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import IconButton from '@mui/material/IconButton';

import { sidebarPinnedStorage } from '@/lib/storage';
import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';

import { NavMobile, NavDesktop } from './nav';
import { HeaderActions } from './header-actions';
import { useJobsBadge } from '../../hooks/use-jobs-badge';
import { BackgroundJobsIndicator } from './background-jobs-indicator';
import { layoutClasses } from '../core/classes';
import { dashboardLayoutVars } from './css-vars';
import { DASHBOARD_CONTENT_QUERY } from './content';
import type { NavItem } from '../nav-config';
import { MainSection } from '../core/main-section';
import { HeaderSection } from '../core/header-section';
import { LayoutSection } from '../core/layout-section';

import type { LayoutSectionProps } from '../core/layout-section';

type LayoutBaseProps = Pick<LayoutSectionProps, 'sx' | 'children' | 'cssVars'>;

export type DashboardLayoutProps = LayoutBaseProps & {
  layoutQuery?: Breakpoint;
  navigation: NavItem[];
};

export function DashboardLayout({
  sx,
  cssVars,
  children,
  navigation,
  layoutQuery = 'md',
}: DashboardLayoutProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isDesktop = useMediaQuery(theme.breakpoints.up(layoutQuery));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  // Mobile Drawer restores focus here after its exit transition (see NavMobile).
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
      slotProps={{
        // Header gutter tracks the content gutter so the leading icon and the
        // route title share one left edge on desktop.
        container: {
          sx: { px: { [DASHBOARD_CONTENT_QUERY]: 'var(--layout-dashboard-content-px)' } },
        },
      }}
      slots={{
        leftArea: (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {!isDesktop && (
              <Tooltip title={t('header.menuAria')}>
                <IconButton
                  ref={menuButtonRef}
                  aria-label={t('header.menuAria')}
                  onClick={() => setMobileOpen(true)}
                  sx={{ mr: 1, ml: -1 }}
                >
                  <Iconify icon="custom:menu-duotone" />
                </IconButton>
              </Tooltip>
            )}
            {isDesktop && (
              <Tooltip title={t('header.sidebarToggleAria')}>
                <IconButton
                  aria-label={t('header.sidebarToggleAria')}
                  aria-expanded={pinned}
                  onClick={togglePinned}
                  sx={{ mr: 1, ml: -1 }}
                >
                  <Iconify icon="solar:siderbar-bold-duotone" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ),
        rightArea: (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              gap: { xs: 0.5, sm: 1 },
            }}
          >
            <BackgroundJobsIndicator />
            <HeaderActions />
          </Box>
        ),
      }}
    />
  );

  return (
    <LayoutSection
      layoutQuery={layoutQuery}
      headerSection={renderHeader()}
      sidebarSection={
        <>
          <NavDesktop data={navigation} layoutQuery={layoutQuery} pinned={pinned} />
          <NavMobile
            data={navigation}
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            onExited={() => menuButtonRef.current?.focus()}
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
