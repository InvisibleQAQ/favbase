import type { CSSObject } from '@mui/material/styles';
import type { NavItemProps } from '../types';

import { mergeClasses } from 'minimal-shared/utils';

import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';

import { Iconify } from '../../iconify';
import { navLinkProps } from '../nav-link-props';
import { navItemStyles, navSectionClasses } from '../styles';

/**
 * Mini-rail row (Minimal `mini/nav-item.tsx`). Root rows are icon-over-title
 * tiles; rows inside the flyout are ordinary icon+title links.
 *
 * D15 does not apply here: the flyout is opened by hover or by ArrowRight (see
 * `mini/nav-list.tsx`), not by a control that would compete with the link, so
 * the tile stays a single link that announces itself with `aria-haspopup`.
 */
export function NavItem({
  path,
  icon,
  info,
  title,
  caption,
  platform,
  external,
  /********/
  open,
  active,
  disabled,
  /********/
  depth,
  hasChild,
  slotProps,
  className,
  ...other
}: NavItemProps) {
  const rootItem = depth === 1;

  const ownerState: StyledState = {
    open,
    active,
    disabled,
    platform,
    variant: rootItem ? 'rootItem' : 'subItem',
  };

  return (
    <ItemRoot
      aria-label={title}
      {...ownerState}
      {...navLinkProps({ path, external })}
      className={mergeClasses([navSectionClasses.item.root, className], {
        [navSectionClasses.state.open]: open,
        [navSectionClasses.state.active]: active,
        [navSectionClasses.state.disabled]: disabled,
      })}
      sx={slotProps?.sx}
      {...other}
    >
      {icon && (
        <ItemIcon {...ownerState} className={navSectionClasses.item.icon} sx={slotProps?.icon}>
          {icon}
        </ItemIcon>
      )}

      {title && (
        <ItemTitle {...ownerState} className={navSectionClasses.item.title} sx={slotProps?.title}>
          {title}
        </ItemTitle>
      )}

      {caption && (
        <Tooltip title={caption} arrow placement="right">
          <ItemCaptionIcon
            {...ownerState}
            icon="eva:info-outline"
            className={navSectionClasses.item.caption}
            sx={slotProps?.caption}
          />
        </Tooltip>
      )}

      {info && !rootItem && (
        <ItemInfo {...ownerState} className={navSectionClasses.item.info} sx={slotProps?.info}>
          {info}
        </ItemInfo>
      )}

      {hasChild && (
        <ItemArrow
          {...ownerState}
          icon="eva:arrow-ios-forward-fill"
          className={navSectionClasses.item.arrow}
          sx={slotProps?.arrow}
        />
      )}
    </ItemRoot>
  );
}

type StyledState = Pick<NavItemProps, 'open' | 'active' | 'disabled' | 'platform'> & {
  variant: 'rootItem' | 'subItem';
};

const shouldForwardProp = (prop: string) =>
  !['open', 'active', 'disabled', 'variant', 'platform', 'sx'].includes(prop);

/**
 * @slot root
 */
const ItemRoot = styled(ButtonBase, { shouldForwardProp })<StyledState>(({
  active,
  open,
  theme,
}) => {
  const rootItemStyles: CSSObject = {
    textAlign: 'center',
    flexDirection: 'column',
    minHeight: 'var(--nav-item-root-height)',
    padding: 'var(--nav-item-root-padding)',
    ...(open && {
      color: 'var(--nav-item-root-open-color)',
      backgroundColor: 'var(--nav-item-root-open-bg)',
    }),
    ...(active && {
      color: 'var(--nav-item-root-active-color)',
      backgroundColor: 'var(--nav-item-root-active-bg)',
      '&:hover': { backgroundColor: 'var(--nav-item-root-active-hover-bg)' },
    }),
  };

  const subItemStyles: CSSObject = {
    minHeight: 'var(--nav-item-sub-height)',
    padding: 'var(--nav-item-sub-padding)',
    justifyContent: 'flex-start',
    color: theme.vars.palette.text.secondary,
    ...(open && {
      color: 'var(--nav-item-sub-open-color)',
      backgroundColor: 'var(--nav-item-sub-open-bg)',
    }),
    ...(active && {
      color: 'var(--nav-item-sub-active-color)',
      backgroundColor: 'var(--nav-item-sub-active-bg)',
      '&:hover': { backgroundColor: 'var(--nav-item-sub-active-hover-bg)' },
    }),
  };

  return {
    width: '100%',
    position: 'relative',
    color: 'var(--nav-item-color)',
    borderRadius: 'var(--nav-item-radius)',
    '&:hover': { backgroundColor: 'var(--nav-item-hover-bg)' },
    variants: [
      { props: { variant: 'rootItem' }, style: rootItemStyles },
      { props: { variant: 'subItem' }, style: subItemStyles },
      { props: { disabled: true }, style: navItemStyles.disabled },
    ],
  };
});

/**
 * @slot icon — platform tint while inactive, same rule as the vertical rail.
 */
const ItemIcon = styled('span', { shouldForwardProp })<StyledState>(
  ({ platform, active, theme }) => ({
    ...navItemStyles.icon,
    width: 'var(--nav-icon-size)',
    height: 'var(--nav-icon-size)',
    margin: 'var(--nav-icon-root-margin)',
    ...(platform && !active && { color: theme.vars.palette.platform[platform] }),
    variants: [{ props: { variant: 'subItem' }, style: { margin: 'var(--nav-icon-sub-margin)' } }],
  }),
);

/**
 * @slot title
 */
const ItemTitle = styled('span', { shouldForwardProp })<StyledState>(({ active, theme }) => ({
  ...navItemStyles.title(theme),
  lineHeight: '16px',
  textAlign: 'center',
  fontSize: theme.typography.pxToRem(10),
  fontWeight: theme.typography.fontWeightSemiBold,
  variants: [
    {
      props: { variant: 'rootItem' },
      style: { ...(active && { fontWeight: theme.typography.fontWeightBold }) },
    },
    {
      props: { variant: 'subItem' },
      style: {
        ...theme.typography.body2,
        textAlign: 'left',
        fontWeight: theme.typography.fontWeightMedium,
        ...(active && { fontWeight: theme.typography.fontWeightSemiBold }),
      },
    },
  ],
}));

/**
 * @slot caption icon
 */
const ItemCaptionIcon = styled(Iconify, { shouldForwardProp })<StyledState>(() => ({
  ...navItemStyles.captionIcon,
  color: 'var(--nav-item-caption-color)',
  variants: [{ props: { variant: 'rootItem' }, style: { top: 11, left: 6, position: 'absolute' } }],
}));

/**
 * @slot info
 */
const ItemInfo = styled('span', { shouldForwardProp })<StyledState>(() => ({
  ...navItemStyles.info,
}));

/**
 * @slot arrow
 */
const ItemArrow = styled(Iconify, { shouldForwardProp })<StyledState>(({ theme }) => ({
  ...navItemStyles.arrow(theme),
  variants: [
    {
      props: { variant: 'rootItem' },
      style: { margin: 0, top: 11, right: 6, position: 'absolute' },
    },
    { props: { variant: 'subItem' }, style: { marginRight: theme.spacing(-0.5) } },
  ],
}));
