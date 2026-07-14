/**
 * Resolve which sibling nav child leaf is active for the current pathname.
 *
 * Matching is prefix-based on path segments (exact match or `${path}/...`),
 * and the LONGEST matching path wins. After the collections rename the sibling
 * leaves ('/collections/bilibili', '/collections/github') no longer prefix each
 * other, so they are mutually exclusive by construction. Longest-wins now serves
 * to resolve nested detail routes: '/collections/bilibili/:id' still resolves to
 * the Bilibili leaf ('/collections/bilibili').
 */
export function findActiveChildPath(pathname: string, childPaths: string[]): string | null {
  let best: string | null = null;
  for (const path of childPaths) {
    if (pathname !== path && !pathname.startsWith(`${path}/`)) continue;
    if (best === null || path.length > best.length) best = path;
  }
  return best;
}
