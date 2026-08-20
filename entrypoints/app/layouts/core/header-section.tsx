import type { Theme, SxProps, CSSObject, Breakpoint } from '@mui/material/styles';

import { useScrollOffsetTop } from 'minimal-shared/hooks';
import { varAlpha } from 'minimal-shared/utils';

import AppBar from '@mui/material/AppBar';
import { styled } from '@mui/material/styles';
import Container from '@mui/material/Container';

import { layoutClasses } from './classes';

export type HeaderSectionProps = {
  sx?: SxProps<Theme>;
  layoutQuery?: Breakpoint;
  disableOffset?: boolean;
  disableElevation?: boolean;
  slots?: {
    leftArea?: React.ReactNode;
    rightArea?: React.ReactNode;
    topArea?: React.ReactNode;
    centerArea?: React.ReactNode;
  };
};

export function HeaderSection({
  sx,
  slots,
  disableOffset,
  disableElevation,
  layoutQuery = 'md',
}: HeaderSectionProps) {
  const { offsetTop: isOffset } = useScrollOffsetTop();

  return (
    <HeaderRoot
      position="sticky"
      color="transparent"
      isOffset={isOffset}
      disableOffset={disableOffset}
      disableElevation={disableElevation}
      className={layoutClasses.header}
      sx={[
        (theme: Theme) => ({
          ...(isOffset && {
            '--color': `var(--offset-color, ${theme.vars.palette.text.primary})`,
          }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {slots?.topArea}

      <HeaderContainer layoutQuery={layoutQuery} maxWidth={false}>
        {slots?.leftArea}
        <HeaderCenterArea>{slots?.centerArea}</HeaderCenterArea>
        {slots?.rightArea}
      </HeaderContainer>
    </HeaderRoot>
  );
}

type HeaderRootProps = Pick<HeaderSectionProps, 'disableOffset' | 'disableElevation'> & {
  isOffset: boolean;
};

const HeaderRoot = styled(AppBar, {
  shouldForwardProp: (prop: string) =>
    !['isOffset', 'disableOffset', 'disableElevation', 'sx'].includes(prop),
})<HeaderRootProps>(({ isOffset, disableOffset, disableElevation, theme }) => {
  const pauseStyles: CSSObject = {
    opacity: 0,
    content: '""',
    visibility: 'hidden',
    position: 'absolute',
    transition: theme.transitions.create(['opacity', 'visibility'], {
      easing: theme.transitions.easing.easeInOut,
      duration: theme.transitions.duration.shorter,
    }),
  };

  const bgStyles: CSSObject = {
    ...pauseStyles,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: -1,
    backdropFilter: 'blur(var(--layout-header-blur))',
    WebkitBackdropFilter: 'blur(var(--layout-header-blur))',
    backgroundColor: varAlpha(theme.vars.palette.background.defaultChannel, 0.8),
    ...(isOffset && { opacity: 1, visibility: 'visible' }),
  };

  const shadowStyles: CSSObject = {
    ...pauseStyles,
    left: 0,
    right: 0,
    bottom: 0,
    height: 24,
    margin: 'auto',
    borderRadius: '50%',
    width: 'calc(100% - 48px)',
    zIndex: -2,
    boxShadow: theme.vars.customShadows.z8,
    ...(isOffset && { opacity: 0.48, visibility: 'visible' }),
  };

  return {
    boxShadow: 'none',
    zIndex: 'var(--layout-header-zIndex)',
    ...(!disableOffset && { '&::before': bgStyles }),
    ...(!disableElevation && { '&::after': shadowStyles }),
  };
});

const HeaderContainer = styled(Container, {
  shouldForwardProp: (prop: string) => !['layoutQuery', 'sx'].includes(prop),
})<{ layoutQuery?: Breakpoint }>(({ layoutQuery = 'md', theme }) => ({
  display: 'flex',
  alignItems: 'center',
  color: 'var(--color)',
  height: 'var(--layout-header-mobile-height)',
  [theme.breakpoints.up(layoutQuery)]: { height: 'var(--layout-header-desktop-height)' },
}));

const HeaderCenterArea = styled('div')(() => ({
  display: 'flex',
  flex: '1 1 auto',
  justifyContent: 'center',
}));
