/**
 * Resolve which sibling nav child leaf is active for the current pathname.
 *
 * Matching is prefix-based on path segments (exact match or `${path}/...`),
 * and the LONGEST matching path wins. This makes overlapping sibling paths
 * mutually exclusive: '/collections' (Bilibili leaf) no longer highlights
 * under '/collections/github' because the GitHub leaf's longer path takes
 * priority, while '/collections' and '/collections/bilibili/:id' still
 * resolve to the Bilibili leaf.
 */
export function findActiveChildPath(pathname: string, childPaths: string[]): string | null {
  let best: string | null = null;
  for (const path of childPaths) {
    if (pathname !== path && !pathname.startsWith(`${path}/`)) continue;
    if (best === null || path.length > best.length) best = path;
  }
  return best;
}
