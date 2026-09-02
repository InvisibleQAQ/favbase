import type { ComponentProps } from 'react';

import Link from '@mui/material/Link';
import { styled } from '@mui/material/styles';

export type MoreLinksProps = ComponentProps<typeof MoreLinksRoot> & {
  links?: string[];
};

/** Trailing list of external references under the breadcrumb row. */
export function MoreLinks({ links, sx, ...other }: MoreLinksProps) {
  return (
    <MoreLinksRoot sx={sx} {...other}>
      {links?.map((href) => (
        <li key={href}>
          <Link href={href} variant="body2" target="_blank" rel="noopener noreferrer">
            {href}
          </Link>
        </li>
      ))}
    </MoreLinksRoot>
  );
}

const MoreLinksRoot = styled('ul')(() => ({
  display: 'flex',
  flexDirection: 'column',
  '& > li': { display: 'flex' },
}));
