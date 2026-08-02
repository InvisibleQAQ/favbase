import {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from '@/lib/collections/platforms';

const JOB_PLATFORM_BY_COLLECTION: Record<CollectionPlatform, string> = {
  bilibili: 'bilibili',
  github: 'github-stars',
  bookmarks: 'bookmarks',
  x: 'x-bookmarks',
  zhihu: 'zhihu-favorites',
  youtube: 'youtube-playlists',
};

const COLLECTION_PLATFORM_BY_JOB = new Map<string, CollectionPlatform>(
  COLLECTION_PLATFORMS.map((platform) => [JOB_PLATFORM_BY_COLLECTION[platform], platform]),
);

/** Translate a Collection discriminator into its background-job namespace. */
export function jobPlatformForCollection(platform: CollectionPlatform): string {
  return JOB_PLATFORM_BY_COLLECTION[platform];
}

/** Resolve a job namespace or Collection discriminator to the canonical platform. */
export function collectionPlatformForJob(jobPlatform: string): CollectionPlatform | null {
  return (
    COLLECTION_PLATFORM_BY_JOB.get(jobPlatform)
    ?? (isCollectionPlatform(jobPlatform) ? jobPlatform : null)
  );
}
