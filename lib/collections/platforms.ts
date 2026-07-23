/** Supported collection discriminators persisted in the shared items table. */
export const COLLECTION_PLATFORMS = [
  'bilibili',
  'github',
  'bookmarks',
  'x',
  'zhihu',
  'youtube',
] as const;

export type CollectionPlatform = (typeof COLLECTION_PLATFORMS)[number];

const COLLECTION_PLATFORM_SET = new Set<string>(COLLECTION_PLATFORMS);

export function isCollectionPlatform(value: string): value is CollectionPlatform {
  return COLLECTION_PLATFORM_SET.has(value);
}
