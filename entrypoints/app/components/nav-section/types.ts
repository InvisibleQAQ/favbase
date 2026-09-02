import type { ButtonBaseProps } from '@mui/material/ButtonBase';
import type { Theme, SxProps, CSSObject } from '@mui/material/styles';

import type { CollectionPlatform } from '@/lib/collections/platforms';

/**
 * Minimal `components/nav-section/types.ts` minus the horizontal variant and
 * minus the `render` indirection: Favbase's nav data already carries real
 * elements for `icon` / `info` (built in `layouts/nav-config.tsx`), so the
 * string-keyed icon map Minimal needs for its JSON-ish config is dead weight.
 *
 * Strings arriving here are already translated — `layouts/dashboard/layout.tsx`
 * is the i18n boundary, so this whole directory stays a dumb presentational
 * port (no `t()`, no storage).
 */

export type NavItemStateProps = {
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
};

export type NavItemSlotProps = {
  sx?: SxProps<Theme>;
  icon?: SxProps<Theme>;
  texts?: SxProps<Theme>;
  title?: SxProps<Theme>;
  caption?: SxProps<Theme>;
  info?: SxProps<Theme>;
  arrow?: SxProps<Theme>;
};

export type NavSlotProps = {
  rootItem?: NavItemSlotProps;
  subItem?: NavItemSlotProps;
  subheader?: SxProps<Theme>;
  dropdown?: {
    paper?: SxProps<Theme>;
  };
};

export type NavItemOptionsProps = {
  depth?: number;
  hasChild?: boolean;
  slotProps?: NavItemSlotProps;
};

export type NavItemDataProps = Pick<NavItemStateProps, 'disabled'> & {
  path: string;
  /** Already translated (see module doc). */
  title: string;
  icon?: React.ReactNode;
  info?: React.ReactNode;
  /** Already translated; vertical shows it under the title, mini as a tooltip. */
  caption?: string;
  /**
   * Already translated accessible name for the disclosure button of a row with
   * children (D15). Falls back to `title`.
   */
  toggleLabel?: string;
  /**
   * favbase: platform identity color for the icon glyph only
   * (`theme.vars.palette.platform[platform]`), never text or background.
   */
  platform?: CollectionPlatform;
  /** Outbound action link: renders `<a target="_blank">` and never highlights. */
  external?: boolean;
  /** Active also on `${path}/…`. Defaults to `!!children`. */
  deepMatch?: boolean;
  children?: NavItemDataProps[];
};

export type NavItemProps = ButtonBaseProps &
  NavItemDataProps &
  NavItemStateProps &
  NavItemOptionsProps;

export type NavListProps = Pick<NavItemProps, 'depth'> & {
  cssVars?: CSSObject;
  data: NavItemDataProps;
  slotProps?: NavSlotProps;
};

export type NavSubListProps = Omit<NavListProps, 'data'> & {
  data: NavItemDataProps[];
};

export type NavGroupProps = Omit<NavListProps, 'data' | 'depth'> & {
  subheader?: string;
  items: NavItemDataProps[];
};

/** One rendered group: an optional subheader plus its top-level items. */
export type NavSectionData = {
  subheader?: string;
  items: NavItemDataProps[];
};

export type NavSectionProps = React.ComponentProps<'nav'> &
  Omit<NavListProps, 'data' | 'depth'> & {
    sx?: SxProps<Theme>;
    data: NavSectionData[];
  };
