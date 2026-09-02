import type { LinkProps } from '@mui/material/Link';

import { Link as RouterLink } from 'react-router-dom';

import Link from '@mui/material/Link';

import { Iconify } from '../iconify';

export type BackLinkProps = Omit<LinkProps, 'href'> & {
  href: string;
  label?: string;
};

/**
 * Heading that doubles as a way back up one level. Minimal keys its hover rule
 * off `iconifyClasses.root`; our Iconify wrapper exports no class constants, so
 * the rule targets the rendered svg directly.
 */
export function BackLink({ sx, href, label, ...other }: BackLinkProps) {
  return (
    <Link
      component={RouterLink}
      to={href}
      color="inherit"
      underline="none"
      sx={[
        (theme) => ({
          verticalAlign: 'middle',
          '& svg': {
            verticalAlign: 'inherit',
            transform: 'translateY(-2px)',
            marginLeft: { xs: '-14px', md: '-18px' },
            transition: theme.transitions.create(['opacity'], {
              duration: theme.transitions.duration.shorter,
              easing: theme.transitions.easing.sharp,
            }),
          },
          '&:hover svg': { opacity: 0.48 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Iconify width={18} icon="eva:arrow-ios-back-fill" />
      {label}
    </Link>
  );
}
