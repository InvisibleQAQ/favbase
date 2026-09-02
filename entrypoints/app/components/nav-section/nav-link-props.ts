import { Link as RouterLink } from 'react-router-dom';

/**
 * Link props for a nav row (Minimal's `createNavItem` reduced to its one
 * remaining job). Minimal turns a row with children into a `div` so the whole
 * row toggles; Favbase never does that — D15 keeps the row a link and gives the
 * disclosure its own button — so every row here is either a route link or an
 * outbound anchor.
 */
export function navLinkProps({ path, external }: { path: string; external?: boolean }) {
  return external
    ? ({ component: 'a', href: path, target: '_blank', rel: 'noopener noreferrer' } as const)
    : ({ component: RouterLink, to: path } as const);
}
