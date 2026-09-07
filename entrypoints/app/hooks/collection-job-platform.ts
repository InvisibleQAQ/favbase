import { mapPlatforms, PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
import {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from '@/lib/collections/platforms';

/** Background-job namespace per platform, from the Platform Descriptor. */
export const JOB_PLATFORM_BY_COLLECTION = mapPlatforms(
  PLATFORM_DESCRIPTORS,
  (descriptor) => descriptor.jobPlatform,
);

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
