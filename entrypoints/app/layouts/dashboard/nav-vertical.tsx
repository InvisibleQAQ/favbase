import type { Breakpoint } from '@mui/material/styles';
import type { NavSectionProps } from '../../components/nav-section';

import { varAlpha, mergeClasses } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';

import { Scrollbar } from '../../components/scrollbar';
import { NavSectionMini, NavSectionVertical } from '../../components/nav-section';

import { layoutClasses } from '../core/classes';
import { NavToggleButton } from '../components/nav-toggle-button';

export type NavVerticalProps = React.ComponentProps<'div'> &
  NavSectionProps & {
    isNavMini: boolean;
    layoutQuery?: Breakpoint;
    onToggleNav: () => void;
  };

/**
 * Desktop rail (Minimal `layouts/dashboard/nav-vertical.tsx`): one component,
 * two shapes — 300px with titles and group subheaders, 88px with icon tiles and
 * flyouts. `NAV_VERTICAL_WIDTH` (`css-vars.ts`) is the single toggling variable.
 *
 * Scroll ownership is unchanged: the rail is `position: fixed` and its list is
 * the only thing that scrolls inside it — `Scrollbar` when expanded, a
 * `hideScrollY` column when mini, since a flyout must not be clipped by a
 * scroll container.
 */
export function NavVertical({
  sx,
  data,
  cssVars,
  className,
  isNavMini,
  onToggleNav,
  layoutQuery = 'md',
  ...other
}: NavVerticalProps) {
  const renderBrand = () => (
    <Box
      sx={{
        pt: 2.5,
        pb: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        // Logo center on the row icon's vertical axis: rail px 16 + item pl 12
        // + icon 24 / 2 = 40px, minus half the 36px mark.
        ...(isNavMini ? { justifyContent: 'center' } : { pl: 2.75 }),
      }}
    >
      <Box
        component="img"
        src="/icon/128.png"
        alt=""
        sx={{ width: 36, height: 36, borderRadius: 0.5, flexShrink: 0 }}
      />
      {!isNavMini && (
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          favbase
        </Typography>
      )}
    </Box>
  );

  return (
    <>
      <NavToggleButton
        isNavMini={isNavMini}
        onClick={onToggleNav}
        sx={[
          (theme) => ({
            display: 'none',
            [theme.breakpoints.up(layoutQuery)]: { display: 'inline-flex' },
          }),
        ]}
      />

      <NavRoot
        layoutQuery={layoutQuery}
        className={mergeClasses([layoutClasses.nav.root, layoutClasses.nav.vertical, className])}
        sx={sx}
        {...other}
      >
        {renderBrand()}

        {isNavMini ? (
          <NavSectionMini
            data={data}
            cssVars={cssVars}
            sx={[
              (theme) => ({
                ...theme.mixins.hideScrollY,
                pb: 2,
                px: 0.5,
                flex: '1 1 auto',
              }),
            ]}
          />
        ) : (
          <Scrollbar fillContent>
            <NavSectionVertical
              data={data}
              cssVars={cssVars}
              sx={{ px: 2, pb: 2, flex: '1 1 auto' }}
            />
          </Scrollbar>
        )}
      </NavRoot>
    </>
  );
}

const NavRoot = styled('div', {
  shouldForwardProp: (prop: string) => !['layoutQuery', 'sx'].includes(prop),
})<Pick<NavVerticalProps, 'layoutQuery'>>(({ layoutQuery = 'md', theme }) => ({
  top: 0,
  left: 0,
  height: '100%',
  display: 'none',
  position: 'fixed',
  overflow: 'hidden',
  flexDirection: 'column',
  zIndex: 'var(--layout-nav-zIndex)',
  backgroundColor: theme.vars.palette.background.default,
  width: 'var(--layout-nav-vertical-width)',
  borderRight: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
  transition: theme.transitions.create(['width'], {
    easing: 'var(--layout-transition-easing)',
    duration: 'var(--layout-transition-duration)',
  }),
  [theme.breakpoints.up(layoutQuery)]: { display: 'flex' },
}));
