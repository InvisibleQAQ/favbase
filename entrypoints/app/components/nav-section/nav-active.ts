/**
 * Which nav row the current pathname belongs to.
 *
 * Moved here from `layouts/nav-active.ts` in docs/25 Step 4: the ported
 * nav-section computes each row's own state, so the matcher belongs to the
 * component that asks the question (and `components/` must not import
 * `layouts/`). It replaces `findActiveChildPath`, whose longest-wins pass over
 * a sibling set only mattered while leaf paths could prefix one another —
 * after the collections rename they cannot.
 *
 * `deepMatch` (default: rows with children) extends a match to descendants, so
 * `/collections/bilibili/:id` still highlights the Bilibili leaf. Matching is
 * on segment boundaries, never a bare `startsWith`: `/chat` must not light up
 * for `/chatter`. External rows (a full URL) never match.
 */
export function isNavItemActive(pathname: string, path: string, deepMatch = false): boolean {
  if (!pathname || !path) return false;
  if (/^https?:\/\//i.test(path) || path.startsWith('#')) return false;

  const current = removeTrailingSlash(pathname);
  const target = removeTrailingSlash(path);

  if (current === target) return true;

  return deepMatch && current.startsWith(`${target}/`);
}

function removeTrailingSlash(value: string): string {
  return value !== '/' && value.endsWith('/') ? value.slice(0, -1) : value;
}
