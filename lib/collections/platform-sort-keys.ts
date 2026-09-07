import type { CollectionPlatform } from './platforms';
import { mapPlatforms, PLATFORM_DESCRIPTORS, type PlatformSortKey } from './platform-descriptor';

// The type lives with the descriptor that declares the values; this module
// stays its published name for `collections-query` and the barrel (docs/26 Step 2).
export type { PlatformSortKey };

/** Native ordering key per platform, derived from the Platform Descriptor. */
export const PLATFORM_SORT_KEYS: Record<CollectionPlatform, PlatformSortKey> = mapPlatforms(
  PLATFORM_DESCRIPTORS,
  (descriptor) => descriptor.sortKey,
);
