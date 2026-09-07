/**
 * Pure Collection Analytics types, split out of `collection-analytics.ts` so a
 * consumer can name a dimension kind without dragging that module's runtime
 * graph (drizzle + `getDb` + six table entities) into its import graph.
 *
 * `platform-descriptor.ts` needs this Kind and is loaded by `wxt.config.ts` in
 * Node: `import type` erases, so the drizzle pull never actually happens — but
 * the day someone turns that into a value import the build explodes with an
 * error that does not point at the culprit. Splitting the type removes the trap.
 *
 * Runtime analytics (query + snapshot assembly) stays in `collection-analytics.ts`.
 */

/**
 * The facet a Collection Analytics ranking groups by. Every platform declares
 * which kinds it exposes; a new kind must be handled by every UI that renders
 * one (`Record<CollectionAnalyticsDimensionKind, …>` lookups fail compilation).
 */
export type CollectionAnalyticsDimensionKind =
  | 'uploader'
  | 'favoriteFolder'
  | 'language'
  | 'repositoryOwner'
  | 'domain'
  | 'folder'
  | 'author'
  | 'collection'
  | 'channel'
  | 'playlist';
