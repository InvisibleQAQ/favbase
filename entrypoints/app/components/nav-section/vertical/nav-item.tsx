import type { CSSObject } from '@mui/material/styles';
import type { NavItemProps } from '../types';

import { mergeClasses } from 'minimal-shared/utils';

import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';

import { Iconify } from '../../iconify';
import { navLinkProps } from '../nav-link-props';
import { navItemStyles, navSectionClasses } from '../styles';

// favbase override (D15): link and disclosure are sibling controls
// (`.trellis/spec/frontend/ui-design-system.md` §8). Minimal turns a row with
// children into one control that toggles the branch and swallows the link;
// Favbase has a real `/collections` aggregate page, so the row stays a link and
// the arrow becomes its own button. `ItemRoot` is therefore the painted shell
// (a div) and `ItemLink` carries the padding — one code path for leaves and
// branches alike, the difference being whether the disclosure is rendered.

export type VerticalNavItemProps = NavItemProps & {
  /** Id of the collapse this row's disclosure controls. */
  submenuId?: string;
  onToggle?: () => void;
};

export function NavItem({
  path,
  icon,
  info,
  title,
  caption,
  platform,
  external,
  toggleLabel,
  /********/
  open,
  active,
  disabled,
  /********/
  depth,
  hasChild,
  slotProps,
  className,
  submenuId,
  onToggle,
  ...other
}: VerticalNavItemProps) {
  const ownerState: StyledState = {
    open,
    active,
    disabled,
    platform,
    variant: depth === 1 ? 'rootItem' : 'subItem',
  };

  return (
    <ItemRoot
      {...ownerState}
      className={mergeClasses([navSectionClasses.item.root, className], {
        [navSectionClasses.state.open]: open,
        [navSectionClasses.state.active]: active,
        [navSectionClasses.state.disabled]: disabled,
      })}
    >
      <ItemLink
        {...ownerState}
        {...navLinkProps({ path, external })}
        className={navSectionClasses.item.link}
        sx={slotProps?.sx}
        {...other}
      >
        {icon && (
          <ItemIcon {...ownerState} className={navSectionClasses.item.icon} sx={slotProps?.icon}>
            {icon}
          </ItemIcon>
        )}

        {title && (
          <ItemTexts {...ownerState} className={navSectionClasses.item.texts} sx={slotProps?.texts}>
            <ItemTitle {...ownerState} className={navSectionClasses.item.title} sx={slotProps?.title}>
              {title}
            </ItemTitle>

            {caption && (
              <Tooltip title={caption} placement="top-start">
                <ItemCaptionText
                  {...ownerState}
                  className={navSectionClasses.item.caption}
                  sx={slotProps?.caption}
                >
                  {caption}
                </ItemCaptionText>
              </Tooltip>
            )}
          </ItemTexts>
        )}

        {info && (
          <ItemInfo {...ownerState} className={navSectionClasses.item.info} sx={slotProps?.info}>
            {info}
          </ItemInfo>
        )}
      </ItemLink>

      {hasChild && (
        <ItemDisclosure
          type="button"
          aria-label={toggleLabel ?? title}
          aria-expanded={!!open}
          aria-controls={open ? submenuId : undefined}
          onClick={onToggle}
          className={navSectionClasses.item.arrow}
          sx={slotProps?.arrow}
        >
          <Iconify
            width={16}
            icon={open ? 'eva:arrow-ios-downward-fill' : 'eva:arrow-ios-forward-fill'}
          />
        </ItemDisclosure>
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
 * @slot root — painted shell: state colors, radius, row height, tree bullet.
 */
const ItemRoot = styled('div', { shouldForwardProp })<StyledState>(({ active, open }) => {
  const bulletSvg = `"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' viewBox='0 0 14 14'%3E%3Cpath d='M1 1v4a8 8 0 0 0 8 8h4' stroke='%23efefef' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E"`;

  const bulletStyles: CSSObject = {
    left: 0,
    content: '""',
    position: 'absolute',
    width: 'var(--nav-bullet-size)',
    height: 'var(--nav-bullet-size)',
    backgroundColor: 'var(--nav-bullet-color)',
    mask: `url(${bulletSvg}) no-repeat 50% 50%/100% auto`,
    WebkitMask: `url(${bulletSvg}) no-repeat 50% 50%/100% auto`,
    transform:
      'translate(calc(var(--nav-bullet-size) * -1), calc(var(--nav-bullet-size) * -0.4))',
  };

  const rootItemStyles: CSSObject = {
    minHeight: 'var(--nav-item-root-height)',
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
    '&::before': bulletStyles,
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
    display: 'flex',
    position: 'relative',
    alignItems: 'center',
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
 * @slot link — the row's padding and the whole hit area minus the disclosure.
 */
const ItemLink = styled(ButtonBase, { shouldForwardProp })<StyledState>(() => ({
  flex: '1 1 auto',
  minWidth: 0,
  alignSelf: 'stretch',
  color: 'inherit',
  justifyContent: 'flex-start',
  paddingTop: 'var(--nav-item-pt)',
  paddingLeft: 'var(--nav-item-pl)',
  paddingRight: 'var(--nav-item-pr)',
  paddingBottom: 'var(--nav-item-pb)',
  borderRadius: 'var(--nav-item-radius)',
  // The shell paints hover/active; a second wash here would double it.
  '&:hover': { backgroundColor: 'transparent' },
}));

/**
 * @slot arrow — disclosure button (D15), sized to the row it sits in.
 */
const ItemDisclosure = styled(ButtonBase)(({ theme }) => ({
  flexShrink: 0,
  color: 'inherit',
  alignSelf: 'stretch',
  paddingInline: theme.spacing(0.75),
  marginRight: 'var(--nav-item-pr)',
  borderRadius: 'var(--nav-item-radius)',
  '&:hover': { backgroundColor: theme.vars.palette.action.hover },
}));

/**
 * @slot icon — platform rows tint the glyph with their identity color while
 * inactive; the active row's accent ink wins (icons inherit the row color).
 */
const ItemIcon = styled('span', { shouldForwardProp })<StyledState>(
  ({ platform, active, theme }) => ({
    ...navItemStyles.icon,
    width: 'var(--nav-icon-size)',
    height: 'var(--nav-icon-size)',
    margin: 'var(--nav-icon-margin)',
    ...(platform && !active && { color: theme.vars.palette.platform[platform] }),
  }),
);

/**
 * @slot texts
 */
const ItemTexts = styled('span', { shouldForwardProp })<StyledState>(() => ({
  ...navItemStyles.texts,
}));

/**
 * @slot title
 */
const ItemTitle = styled('span', { shouldForwardProp })<StyledState>(({ theme }) => ({
  ...navItemStyles.title(theme),
  ...theme.typography.body2,
  fontWeight: theme.typography.fontWeightMedium,
  variants: [
    { props: { active: true }, style: { fontWeight: theme.typography.fontWeightSemiBold } },
  ],
}));

/**
 * @slot caption text
 */
const ItemCaptionText = styled('span', { shouldForwardProp })<StyledState>(({ theme }) => ({
  ...navItemStyles.captionText(theme),
  color: 'var(--nav-item-caption-color)',
}));

/**
 * @slot info
 */
const ItemInfo = styled('span', { shouldForwardProp })<StyledState>(() => ({
  ...navItemStyles.info,
}));
