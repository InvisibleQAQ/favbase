/**
 * The content region of a collection page ("single list + facet chips + manual
 * sync": github / x / zhihu) is a strict priority ladder. Which state wins is
 * platform-neutral; only the *rendering* of each phase differs. This resolver
 * owns the ladder ORDER so no view can silently drop a short-circuit (e.g. the
 * auth-failed guard) — that ordering invariant is locked by a unit test.
 */
export type CollectionPhase =
  | 'tag-filtered' // tag filter active — tagged grid takes over
  | 'query-error' // paged PGlite query threw
  | 'auth-failed' // sync surfaced an auth error → login guide
  | 'sync-error' // sync failed AND library is empty → error box
  | 'skeleton' // meta/first-page loading
  | 'empty-library' // nothing collected yet → sync guide
  | 'no-matches' // filters matched nothing
  | 'grid'; // normal card grid

export interface CollectionPhaseInput {
  /** selectedTagIds.length > 0 */
  tagFiltered: boolean;
  /** paged query error present */
  queryError: boolean;
  /** sync error classified as auth (platforms without this concept pass false) */
  authFailed: boolean;
  /** any sync error AND libraryCount === 0 */
  syncErrorEmpty: boolean;
  /** library meta still loading */
  metaLoading: boolean;
  /** syncing AND libraryCount === 0 (first sync, no persisted data yet) */
  syncingEmpty: boolean;
  /** libraryCount === 0 */
  libraryEmpty: boolean;
  /** paged query in flight (library already known non-empty) */
  loading: boolean;
  /** current page returned zero rows */
  noMatches: boolean;
}

/**
 * Resolve which content phase a collection page is in. The branch order IS the
 * contract — do not reorder without updating collection-phase.test.ts.
 */
export function resolveCollectionPhase(s: CollectionPhaseInput): CollectionPhase {
  if (s.tagFiltered) return 'tag-filtered';
  if (s.queryError) return 'query-error';
  if (s.authFailed) return 'auth-failed';
  if (s.syncErrorEmpty) return 'sync-error';
  if (s.metaLoading || s.syncingEmpty) return 'skeleton';
  if (s.libraryEmpty) return 'empty-library';
  if (s.loading) return 'skeleton';
  if (s.noMatches) return 'no-matches';
  return 'grid';
}
