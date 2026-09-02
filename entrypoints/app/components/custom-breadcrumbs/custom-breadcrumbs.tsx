import type { ReactNode, ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';
import type { BreadcrumbsProps } from '@mui/material/Breadcrumbs';
import type { MoreLinksProps } from './more-links';
import type { BreadcrumbsLinkProps } from './breadcrumb-link';

import Breadcrumbs from '@mui/material/Breadcrumbs';

import { BackLink } from './back-link';
import { MoreLinks } from './more-links';
import { BreadcrumbsLink } from './breadcrumb-link';
import {
  BreadcrumbsRoot,
  BreadcrumbsHeading,
  BreadcrumbsContent,
  BreadcrumbsContainer,
  BreadcrumbsSeparator,
} from './styles';

export type CustomBreadcrumbsSlotProps = {
  breadcrumbs: BreadcrumbsProps;
  moreLinks: Omit<MoreLinksProps, 'links'>;
  heading: ComponentProps<typeof BreadcrumbsHeading>;
  content: ComponentProps<typeof BreadcrumbsContent>;
  container: ComponentProps<typeof BreadcrumbsContainer>;
};

export type CustomBreadcrumbsSlots = {
  breadcrumbs?: ReactNode;
};

export type CustomBreadcrumbsProps = ComponentProps<'div'> & {
  sx?: SxProps<Theme>;
  heading?: ReactNode;
  /** Make the trailing crumb a live link too. Off by default: it is this page. */
  activeLast?: boolean;
  backHref?: string;
  action?: ReactNode;
  links?: BreadcrumbsLinkProps[];
  moreLinks?: MoreLinksProps['links'];
  slots?: CustomBreadcrumbsSlots;
  slotProps?: Partial<CustomBreadcrumbsSlotProps>;
  /**
   * Extra content stacked under the trail, inside the heading column. Not in
   * Minimal — Favbase pages carry a status caption (count / last synced) that
   * has to stay in the same column as the heading it describes.
   */
  children?: ReactNode;
};

/**
 * Page heading with its ancestry above it and the page's one action to the
 * right. The heading is the page's single h1 (see `styles.tsx`).
 */
export function CustomBreadcrumbs({
  sx,
  action,
  backHref,
  heading,
  slots = {},
  links = [],
  moreLinks = [],
  slotProps = {},
  activeLast = false,
  children,
  ...other
}: CustomBreadcrumbsProps) {
  const lastIndex = links.length - 1;

  const renderHeading = () => (
    <BreadcrumbsHeading {...slotProps?.heading}>
      {backHref ? (
        <BackLink href={backHref} label={typeof heading === 'string' ? heading : undefined} />
      ) : (
        heading
      )}
    </BreadcrumbsHeading>
  );

  const renderLinks = () =>
    slots?.breadcrumbs ?? (
      <Breadcrumbs separator={<BreadcrumbsSeparator />} {...slotProps?.breadcrumbs}>
        {links.map((link, index) => (
          <BreadcrumbsLink
            key={link.name ?? index}
            icon={link.icon}
            href={link.href}
            name={link.name}
            disabled={index === lastIndex && !activeLast}
          />
        ))}
      </Breadcrumbs>
    );

  return (
    <BreadcrumbsRoot sx={sx} {...other}>
      <BreadcrumbsContainer {...slotProps?.container}>
        <BreadcrumbsContent {...slotProps?.content}>
          {(heading != null || backHref) && renderHeading()}
          {(!!links.length || slots?.breadcrumbs) && renderLinks()}
          {children}
        </BreadcrumbsContent>
        {action}
      </BreadcrumbsContainer>

      {!!moreLinks?.length && <MoreLinks links={moreLinks} {...slotProps?.moreLinks} />}
    </BreadcrumbsRoot>
  );
}
