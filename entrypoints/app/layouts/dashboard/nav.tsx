import type { Theme, SxProps, Breakpoint } from '@mui/material/styles';

import { useEffect } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import ListItemButton from '@mui/material/ListItemButton';
import Drawer, { drawerClasses } from '@mui/material/Drawer';

import { useLocation, Link as RouterLink } from 'react-router-dom';

import type { NavItem } from '../nav-config';

export type NavContentProps = {
  data: NavItem[];
  sx?: SxProps<Theme>;
};

export function NavDesktop({
  sx,
  data,
  layoutQuery,
}: NavContentProps & { layoutQuery: Breakpoint }) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        pt: 2.5,
        px: 2.5,
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
        [theme.breakpoints.up(layoutQuery)]: { display: 'flex' },
        ...sx,
      }}
    >
      <NavContent data={data} />
    </Box>
  );
}

export function NavMobile({
  sx,
  data,
  open,
  onClose,
}: NavContentProps & { open: boolean; onClose: () => void }) {
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
      <NavContent data={data} />
    </Drawer>
  );
}

function NavContent({ data, sx }: NavContentProps) {
  const { pathname } = useLocation();

  return (
    <>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5, px: 0.5 }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,
            bgcolor: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="h6" sx={{ color: 'common.white', fontWeight: 800, lineHeight: 1 }}>
            F
          </Typography>
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          favbase
        </Typography>
      </Box>

      <Box
        component="nav"
        sx={[
          { display: 'flex', flex: '1 1 auto', flexDirection: 'column' },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Box component="ul" sx={{ gap: 0.5, display: 'flex', flexDirection: 'column' }}>
          {data.map((item) => {
            const isActive = item.path === pathname;

            return (
              <ListItem disableGutters disablePadding key={item.title}>
                <ListItemButton
                  disableGutters
                  component={RouterLink}
                  to={item.path}
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
                    {item.title}
                  </Box>
                  {item.info && item.info}
                </ListItemButton>
              </ListItem>
            );
          })}
        </Box>
      </Box>
    </>
  );
}
