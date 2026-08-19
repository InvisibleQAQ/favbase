import {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from '@/lib/collections/platforms';

export const JOB_PLATFORM_BY_COLLECTION = {
  bilibili: 'bilibili',
  github: 'github-stars',
  bookmarks: 'bookmarks',
  x: 'x-bookmarks',
  zhihu: 'zhihu-favorites',
  youtube: 'youtube-playlists',
} as const satisfies Record<CollectionPlatform, string>;

export type CollectionJobPlatform = (typeof JOB_PLATFORM_BY_COLLECTION)[CollectionPlatform];

const COLLECTION_PLATFORM_BY_JOB = new Map<string, CollectionPlatform>(
  COLLECTION_PLATFORMS.map((platform) => [JOB_PLATFORM_BY_COLLECTION[platform], platform]),
);

/** Translate a Collection discriminator into its background-job namespace. */
export function jobPlatformForCollection(platform: CollectionPlatform): CollectionJobPlatform {
  return JOB_PLATFORM_BY_COLLECTION[platform];
}

/** Resolve a job namespace or Collection discriminator to the canonical platform. */
export function collectionPlatformForJob(jobPlatform: string): CollectionPlatform | null {
  return (
    COLLECTION_PLATFORM_BY_JOB.get(jobPlatform)
    ?? (isCollectionPlatform(jobPlatform) ? jobPlatform : null)
  );
}
