import type { Theme, SxProps, Breakpoint } from '@mui/material/styles';

import { useState, useEffect } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import ListItem from '@mui/material/ListItem';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import ListItemButton from '@mui/material/ListItemButton';
import Drawer, { drawerClasses } from '@mui/material/Drawer';

import { useLocation, Link as RouterLink } from 'react-router-dom';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { NavItem } from '../nav-config';

export type NavContentProps = {
  data: NavItem[];
  sx?: SxProps<Theme>;
  pinned?: boolean;
};

export function NavDesktop({
  sx,
  data,
  layoutQuery,
  pinned = true,
}: NavContentProps & { layoutQuery: Breakpoint }) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        pt: 2.5,
        px: pinned ? 2.5 : 1,
        top: 0,
        left: 0,
        height: 1,
        display: 'none',
        position: 'fixed',
        flexDirection: 'column',
        bgcolor: 'background.default',
        zIndex: 'var(--layout-nav-zIndex)',
        width: 'var(--layout-nav-vertical-width)',
        borderRight: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
        transition: theme.transitions.create(['width', 'padding'], {
          easing: 'var(--layout-transition-easing)',
          duration: 'var(--layout-transition-duration)',
        }),
        [theme.breakpoints.up(layoutQuery)]: { display: 'flex' },
        ...sx,
      }}
    >
      <NavContent data={data} pinned={pinned} />
    </Box>
  );
}

export function NavMobile({
  sx,
  data,
  open,
  onClose,
}: Omit<NavContentProps, 'pinned'> & { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();

  useEffect(() => {
    if (open) onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer
      open={open}
      onClose={onClose}
      sx={{
        [`& .${drawerClasses.paper}`]: {
          pt: 2.5,
          px: 2.5,
          overflow: 'unset',
          bgcolor: 'background.default',
          width: 'var(--layout-nav-mobile-width)',
          ...sx,
        },
      }}
    >
      <NavContent data={data} pinned />
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Shared leaf button (top-level: Dashboard / Collections / Settings)
// ---------------------------------------------------------------------------

function NavLeafButton({
  item,
  isActive,
  pinned,
}: {
  item: NavItem;
  isActive: boolean;
  pinned: boolean;
}) {
  const { t } = useTranslation();

  const button = (
    <ListItemButton
      disableGutters
      component={RouterLink}
      to={item.path}
      sx={[
        (theme) => ({
          pl: pinned ? 2 : 0,
          py: 1,
          gap: pinned ? 2 : 0,
          pr: pinned ? 1.5 : 0,
          borderRadius: 0.75,
          typography: 'body2',
          fontWeight: 'fontWeightMedium',
          color: theme.vars.palette.text.secondary,
          minHeight: 44,
          justifyContent: pinned ? 'flex-start' : 'center',
          ...(isActive && {
            fontWeight: 'fontWeightSemiBold',
            color: theme.vars.palette.primary.main,
            bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
            '&:hover': {
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
            },
          }),
        }),
      ]}
    >
      <Box component="span" sx={{ width: 24, height: 24, display: 'flex' }}>
        {item.icon}
      </Box>
      {pinned && (
        <>
          <Box component="span" sx={{ flexGrow: 1 }}>
            {t(item.title)}
          </Box>
          {item.info && item.info}
        </>
      )}
    </ListItemButton>
  );

  return (
    <ListItem disableGutters disablePadding>
      {pinned ? (
        button
      ) : (
        <Tooltip title={t(item.title)} placement="right" arrow>
          {button}
        </Tooltip>
      )}
    </ListItem>
  );
}

// ---------------------------------------------------------------------------
// Chevron indicator for expandable branches
// ---------------------------------------------------------------------------

function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <Iconify
      icon={expanded ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'}
      width={16}
      sx={{ color: 'text.disabled', flexShrink: 0 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Child leaf (second level, e.g. Bilibili Favorites): indented RouterLink text
// wired to the parent via a fishbone connector — a vertical spine segment plus
// a horizontal rib per leaf. The last leaf's spine stops at the rib midpoint to
// form an L-corner instead of a hanging tail. Primary highlight when active.
// ---------------------------------------------------------------------------

const FISHBONE_RIB = 14; // px reach from spine to leaf

function NavChildLeaf({
  item,
  isActive,
  isLast,
}: {
  item: NavItem;
  isActive: boolean;
  isLast: boolean;
}) {
  const { t } = useTranslation();

  return (
    <ListItem
      disableGutters
      disablePadding
      sx={(theme) => {
        const rail = varAlpha(theme.vars.palette.grey['500Channel'], 0.24);
        return {
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: isLast ? '50%' : '100%',
            borderLeft: `1px solid ${rail}`,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: '50%',
            width: FISHBONE_RIB,
            height: 0,
            borderTop: `1px solid ${rail}`,
          },
        };
      }}
    >
      <ListItemButton
        disableGutters
        component={RouterLink}
        to={item.path}
        sx={[
          (theme) => ({
            ml: `${FISHBONE_RIB}px`,
            pl: 1,
            py: 0.75,
            pr: 1,
            borderRadius: 0.75,
            minHeight: 36,
            typography: 'body2',
            color: theme.vars.palette.text.secondary,
            ...(isActive && {
              fontWeight: 'fontWeightSemiBold',
              color: theme.vars.palette.primary.main,
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
              '&:hover': {
                bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
              },
            }),
          }),
        ]}
      >
        <Box
          component="span"
          sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {t(item.title)}
        </Box>
      </ListItemButton>
    </ListItem>
  );
}

// ---------------------------------------------------------------------------
// Collections branch: collapsible parent (pinned) or icon-only jump (unpinned)
// ---------------------------------------------------------------------------

function CollectionsBranch({ item, pinned }: { item: NavItem; pinned: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isActive = pathname.startsWith(item.path);
  const [expanded, setExpanded] = useState(isActive);

  // Auto-expand whenever we navigate into a matching route.
  useEffect(() => {
    if (pathname.startsWith(item.path)) setExpanded(true);
  }, [pathname, item.path]);

  // Unpinned (72px): icon-only, click jumps to /collections (RouterLink), no tree.
  if (!pinned) {
    return <NavLeafButton item={item} isActive={isActive} pinned={false} />;
  }

  return (
    <ListItem disableGutters disablePadding sx={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <ListItemButton
        disableGutters
        onClick={() => setExpanded((prev) => !prev)}
        sx={[
          (theme) => ({
            pl: 2,
            py: 1,
            gap: 2,
            pr: 1.5,
            borderRadius: 0.75,
            typography: 'body2',
            fontWeight: 'fontWeightMedium',
            color: theme.vars.palette.text.secondary,
            minHeight: 44,
            ...(isActive && {
              fontWeight: 'fontWeightSemiBold',
              color: theme.vars.palette.primary.main,
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
              '&:hover': {
                bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
              },
            }),
          }),
        ]}
      >
        <Box component="span" sx={{ width: 24, height: 24, display: 'flex' }}>
          {item.icon}
        </Box>
        <Box component="span" sx={{ flexGrow: 1 }}>
          {t(item.title)}
        </Box>
        <ExpandChevron expanded={expanded} />
      </ListItemButton>

      <Collapse in={expanded} unmountOnExit sx={{ width: 1 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            mt: 0.25,
            // Fishbone spine sits under the parent icon's vertical midline:
            // parent icon center = pl(16px) + icon(24px)/2 = 28px = ml 3.5.
            // The spine + ribs themselves are drawn per-leaf in NavChildLeaf.
            ml: 3.5,
          }}
        >
          {(item.children ?? []).map((child, idx, arr) => (
            <NavChildLeaf
              key={child.title}
              item={child}
              isActive={pathname.startsWith(child.path)}
              isLast={idx === arr.length - 1}
            />
          ))}
        </Box>
      </Collapse>
    </ListItem>
  );
}

function NavContent({ data, sx, pinned = true }: NavContentProps) {
  const { pathname } = useLocation();

  return (
    <>
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: pinned ? 0.5 : 0,
          justifyContent: pinned ? 'flex-start' : 'center',
        }}
      >
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            bgcolor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Typography variant="h6" sx={{ color: 'common.white', fontWeight: 800, lineHeight: 1 }}>
            F
          </Typography>
        </Box>
        {pinned && (
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            favbase
          </Typography>
        )}
      </Box>

      <Box
        component="nav"
        sx={[
          { display: 'flex', flex: '1 1 auto', flexDirection: 'column' },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Box component="ul" sx={{ gap: 0.5, display: 'flex', flexDirection: 'column' }}>
          {data.map((item) =>
            item.children ? (
              <CollectionsBranch key={item.title} item={item} pinned={pinned} />
            ) : (
              <NavLeafButton
                key={item.title}
                item={item}
                isActive={item.path === pathname}
                pinned={pinned}
              />
            ),
          )}
        </Box>
      </Box>
    </>
  );
}
