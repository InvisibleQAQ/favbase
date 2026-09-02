import type { ReactNode, ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import { Link as RouterLink } from 'react-router-dom';

import Link from '@mui/material/Link';
import { styled } from '@mui/material/styles';

export type BreadcrumbsLinkProps = ComponentProps<'div'> & {
  name?: string;
  /** Hash-router path. Omit on the trailing crumb — it is the current page. */
  href?: string;
  disabled?: boolean;
  icon?: ReactNode;
  sx?: SxProps<Theme>;
};

/**
 * One crumb. The trailing crumb is rendered `disabled` — it names the page you
 * are already on, so it is inert and marked `aria-current="page"`.
 */
export function BreadcrumbsLink({ href, icon, name, disabled, ...other }: BreadcrumbsLinkProps) {
  const renderContent = () => (
    <ItemRoot disabled={disabled} aria-current={disabled ? 'page' : undefined} {...other}>
      {icon && <ItemIcon>{icon}</ItemIcon>}
      {name}
    </ItemRoot>
  );

  if (href && !disabled) {
    return (
      <Link component={RouterLink} to={href} color="inherit" sx={{ display: 'inline-flex' }}>
        {renderContent()}
      </Link>
    );
  }

  return renderContent();
}

const ItemRoot = styled('div', {
  shouldForwardProp: (prop: string) => !['disabled', 'sx'].includes(prop),
})<Pick<BreadcrumbsLinkProps, 'disabled'>>(({ disabled, theme }) => ({
  ...theme.typography.body2,
  alignItems: 'center',
  gap: theme.spacing(0.5),
  display: 'inline-flex',
  color: theme.vars.palette.text.primary,
  ...(disabled && {
    cursor: 'default',
    pointerEvents: 'none',
    color: theme.vars.palette.text.disabled,
  }),
}));

const ItemIcon = styled('span')(() => ({
  display: 'inherit',
  '& > :first-of-type:not(style):not(:first-of-type ~ *), & > style + *': {
    width: 20,
    height: 20,
  },
}));
