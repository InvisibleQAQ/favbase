import type { CollectionPage, CollectionQueryParams } from './use-collection-library';

/**
 * The generic `queryFn` normalisation every single-facet platform shares:
 * the hook's `filter` goes to the platform query's own facet key, and a
 * `null` filter / `''` search becomes an omitted field. Call it at module
 * level so the returned function is a stable reference.
 */
export function facetQuery<TQuery extends { search?: string; page: number; pageSize: number }, TItem>(
  query: (q: TQuery) => Promise<CollectionPage<TItem>>,
  facetKey: Exclude<keyof TQuery, 'search' | 'page' | 'pageSize'>,
): (params: CollectionQueryParams) => Promise<CollectionPage<TItem>> {
  return ({ filter, search, page, pageSize }) =>
    query({ [facetKey]: filter ?? undefined, search: search || undefined, page, pageSize } as TQuery);
}
