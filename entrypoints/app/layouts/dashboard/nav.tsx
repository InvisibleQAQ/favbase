import type { Theme, SxProps, Breakpoint } from '@mui/material/styles';

import { useId, useRef, useState, useEffect } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import ListItem from '@mui/material/ListItem';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import ListItemButton from '@mui/material/ListItemButton';
import Drawer from '@mui/material/Drawer';

import { useLocation, Link as RouterLink } from 'react-router-dom';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { findActiveChildPath } from '../nav-active';
import type { NavItem } from '../nav-config';

// ---------------------------------------------------------------------------
// Geometry comes from dashboardLayoutVars (dashboard/css-vars.ts), the single
// owner of the shell contract. Row padding follows Minimal's vertical nav:
// 12px leading, 12px icon gap, 8px trailing, 8px base radius.
// ---------------------------------------------------------------------------

const NAV_ICON_CLASS = 'favbase-nav-icon';
const NAV_ROW_HEIGHT = 'var(--layout-nav-item-height)';
const NAV_CHILD_ROW_HEIGHT = 'var(--layout-nav-child-item-height)';
const NAV_COMPACT_SIZE = 'var(--layout-nav-compact-item-size)';
const NAV_ROW_PL = 1.5;
const NAV_ROW_GAP = 1.5;
const NAV_ICON_SIZE = 24;
// Fishbone spine sits under the parent icon's vertical midline:
// row pl (12px) + icon (24px) / 2 = 24px = 3 units.
const NAV_CHILD_INDENT = 3;
const FISHBONE_RIB = 14; // px reach from spine to leaf
// Single-line title: the longest zh/en label must truncate, never wrap or overflow.
const NAV_TITLE_SX = {
  flexGrow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

// Active state shared by every nav row: coral wash under ink text, weight up,
// coral only on the icon glyph. Coral is never the text color (2.5:1 on paper).
// Hovering an active row deepens the wash so active/hover stay distinguishable.
function navActiveSx(theme: Theme) {
  return {
    fontWeight: 'fontWeightSemiBold',
    color: theme.vars.palette.text.primary,
    bgcolor: theme.vars.palette.primary.lighter,
    '&:hover': { bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.24) },
    [`& .${NAV_ICON_CLASS}`]: { color: theme.vars.palette.primary.main },
  } as const;
}

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
        // Compact: center one square target inside the compact width.
        px: pinned ? 2 : `calc((var(--layout-nav-vertical-width) - ${NAV_COMPACT_SIZE}) / 2)`,
        top: 0,
        left: 0,
        height: 1,
        display: 'none',
        position: 'fixed',
        overflow: 'hidden',
        flexDirection: 'column',
        bgcolor: 'background.default',
        zIndex: 'var(--layout-nav-zIndex)',
        width: 'var(--layout-nav-vertical-width)',
        borderRight: `1px solid ${theme.vars.palette.divider}`,
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

/**
 * Temporary Drawer for < layoutQuery. Closes itself when the pathname changes
 * and hands focus back through `onExited` only after the exit transition —
 * the MUI 7 + React 19 ordering contract shared with the Chat history drawer
 * (`disableRestoreFocus` + blur the focused descendant in
 * `onTransitionExited`, restore the trigger from the transition's `onExited`).
 */
export function NavMobile({
  sx,
  data,
  open,
  onClose,
  onExited,
}: Omit<NavContentProps, 'pinned'> & {
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
}) {
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
          sx: [
            {
              pt: 2.5,
              px: 2,
              overflow: 'unset',
              bgcolor: 'background.default',
              width: 'var(--layout-nav-mobile-width)',
            },
            ...(Array.isArray(sx) ? sx : [sx]),
          ],
        },
      }}
    >
      <NavContent data={data} pinned />
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Shared leaf button (top-level: Dashboard / Collections / Settings). Compact
// mode renders a square icon-only target with a right-hand Tooltip.
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
          borderRadius: 1,
          typography: 'body2',
          fontWeight: 'fontWeightMedium',
          color: theme.vars.palette.text.secondary,
          ...(pinned
            ? {
                pl: NAV_ROW_PL,
                pr: 1,
                py: 0.5,
                gap: NAV_ROW_GAP,
                minHeight: NAV_ROW_HEIGHT,
              }
            : {
                p: 0,
                flex: '0 0 auto',
                width: NAV_COMPACT_SIZE,
                height: NAV_COMPACT_SIZE,
                justifyContent: 'center',
              }),
          ...(isActive && navActiveSx(theme)),
        }),
      ]}
    >
      <NavIconSlot>{item.icon}</NavIconSlot>
      {pinned && (
        <>
          <Box component="span" sx={NAV_TITLE_SX}>
            {t(item.title)}
          </Box>
          {item.info && item.info}
        </>
      )}
    </ListItemButton>
  );

  return (
    <ListItem disableGutters disablePadding sx={{ justifyContent: 'center' }}>
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

function NavIconSlot({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      className={NAV_ICON_CLASS}
      sx={{
        width: NAV_ICON_SIZE,
        height: NAV_ICON_SIZE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
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
// An `external` item (Platform Request) renders <a target="_blank"> instead,
// dimmed and with a trailing outbound arrow: it is an action, not a page.
// ---------------------------------------------------------------------------

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
      sx={(theme) => ({
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: isLast ? '50%' : '100%',
          borderLeft: `1px solid ${theme.vars.palette.divider}`,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: '50%',
          width: FISHBONE_RIB,
          height: 0,
          borderTop: `1px solid ${theme.vars.palette.divider}`,
        },
      })}
    >
      <ListItemButton
        disableGutters
        {...(item.external
          ? ({ component: 'a', href: item.path, target: '_blank', rel: 'noopener noreferrer' } as const)
          : { component: RouterLink, to: item.path })}
        sx={[
          (theme) => {
            const itemColor = item.external
              ? theme.vars.palette.text.disabled
              : theme.vars.palette.text.secondary;
            const iconColor = item.platform
              ? theme.vars.palette.platform[item.platform]
              : itemColor;

            return {
              ml: `${FISHBONE_RIB}px`,
              pl: 1,
              py: 0.5,
              pr: 1,
              borderRadius: 1,
              minHeight: NAV_CHILD_ROW_HEIGHT,
              gap: 1,
              alignItems: 'center',
              typography: 'body2',
              color: itemColor,
              [`& .${NAV_ICON_CLASS}`]: { color: iconColor },
              ...(isActive && navActiveSx(theme)),
            };
          },
        ]}
      >
        {item.icon && (
          <Box
            component="span"
            className={NAV_ICON_CLASS}
            sx={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {item.icon}
          </Box>
        )}
        <Box component="span" sx={NAV_TITLE_SX}>
          {t(item.title)}
        </Box>
        {item.external && (
          <Iconify
            icon="eva:diagonal-arrow-right-up-fill"
            width={14}
            sx={{ flexShrink: 0, color: 'text.disabled' }}
          />
        )}
      </ListItemButton>
    </ListItem>
  );
}

// ---------------------------------------------------------------------------
// Collections branch: collapsible parent (pinned) or icon-only jump (compact)
// ---------------------------------------------------------------------------

function CollectionsBranch({ item, pinned }: { item: NavItem; pinned: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isActive = pathname.startsWith(item.path);
  const [expanded, setExpanded] = useState(isActive);
  const submenuId = useId();

  const children = item.children ?? [];
  // Longest-prefix match: sibling leaves ('/collections/bilibili',
  // '/collections/github') are non-overlapping, so highlighting is mutually
  // exclusive by construction; longest-wins resolves nested detail routes
  // ('/collections/bilibili/:id') to their platform leaf. See nav-active.ts.
  const activeChildPath = findActiveChildPath(
    pathname,
    children.map((child) => child.path),
  );

  // Auto-expand whenever we navigate into a matching route.
  useEffect(() => {
    if (pathname.startsWith(item.path)) setExpanded(true);
  }, [pathname, item.path]);

  // Compact: icon-only, click jumps to /collections (RouterLink), no tree.
  if (!pinned) {
    return <NavLeafButton item={item} isActive={isActive} pinned={false} />;
  }

  return (
    <ListItem disableGutters disablePadding sx={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <Box
        sx={[
          (theme) => ({
            display: 'flex',
            alignItems: 'center',
            borderRadius: 1,
            typography: 'body2',
            fontWeight: 'fontWeightMedium',
            color: theme.vars.palette.text.secondary,
            minHeight: NAV_ROW_HEIGHT,
            '&:hover': {
              bgcolor: theme.vars.palette.action.hover,
            },
            ...(isActive && navActiveSx(theme)),
          }),
        ]}
      >
        <ListItemButton
          disableGutters
          component={RouterLink}
          to={item.path}
          sx={{
            pl: NAV_ROW_PL,
            py: 0.5,
            gap: NAV_ROW_GAP,
            pr: 0.5,
            flex: '1 1 auto',
            minWidth: 0,
            alignSelf: 'stretch',
            color: 'inherit',
            fontWeight: 'inherit',
            borderRadius: 1,
            '&:hover': { bgcolor: 'transparent' },
          }}
        >
          <NavIconSlot>{item.icon}</NavIconSlot>
          <Box component="span" sx={NAV_TITLE_SX}>
            {t(item.title)}
          </Box>
        </ListItemButton>
        <IconButton
          type="button"
          aria-label={t(item.title)}
          aria-controls={expanded ? submenuId : undefined}
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          sx={{
            width: NAV_ROW_HEIGHT,
            height: NAV_ROW_HEIGHT,
            flexShrink: 0,
            color: 'inherit',
            borderRadius: 1,
          }}
        >
          <ExpandChevron expanded={expanded} />
        </IconButton>
      </Box>

      <Collapse id={submenuId} in={expanded} unmountOnExit sx={{ width: 1 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            mt: 0.25,
            // The spine + ribs themselves are drawn per-leaf in NavChildLeaf.
            ml: NAV_CHILD_INDENT,
          }}
        >
          {children.map((child, idx, arr) => (
            <NavChildLeaf
              key={child.title}
              item={child}
              isActive={child.path === activeChildPath}
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
          // Logo center lines up with the row icon center (row pl 12 + 12).
          pl: pinned ? 0.75 : 0,
          justifyContent: pinned ? 'flex-start' : 'center',
        }}
      >
        <Box
          component="img"
          src="/icon/128.png"
          alt=""
          sx={{
            width: 36,
            height: 36,
            borderRadius: 0.5,
            flexShrink: 0,
          }}
        />
        {pinned && (
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            favbase
          </Typography>
        )}
      </Box>

      <Box
        component="nav"
        sx={[
          {
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            // The sidebar is the only thing that scrolls inside the fixed rail.
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            pb: 2,
          },
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
