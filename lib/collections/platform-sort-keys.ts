import type { CollectionPlatform } from './platforms';

export type PlatformSortKey =
  | { readonly source: 'publishedAt' }
  | {
      readonly source: 'meta';
      readonly field: string;
      readonly format: 'unixSeconds' | 'iso8601';
    };

export const PLATFORM_SORT_KEYS: Record<CollectionPlatform, PlatformSortKey> = {
  bilibili: { source: 'meta', field: 'fav_time', format: 'unixSeconds' },
  github: { source: 'meta', field: 'starredAt', format: 'iso8601' },
  bookmarks: { source: 'publishedAt' },
  x: { source: 'publishedAt' },
  zhihu: { source: 'publishedAt' },
  youtube: { source: 'meta', field: 'addedAt', format: 'iso8601' },
};
