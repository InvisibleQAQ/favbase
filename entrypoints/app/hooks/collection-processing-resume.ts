import type { CollectionPlatform } from '@/lib/collections/platforms';

import {
  startCollectionProcessingBacklog,
  type CollectionProcessingCapability,
  type StartCollectionProcessingBacklogInput,
} from './collection-processing-jobs';
import { jobPlatformForCollection } from './collection-job-platform';

export interface CollectionProcessingResumeDeps {
  startBacklog: (input: StartCollectionProcessingBacklogInput) => void;
}

const defaultDeps: CollectionProcessingResumeDeps = {
  startBacklog: startCollectionProcessingBacklog,
};

/** Resume one platform's persisted downstream backlog in the current app runtime. */
export function resumeCollectionProcessing(
  platform: CollectionPlatform,
  capability: CollectionProcessingCapability,
  deps: CollectionProcessingResumeDeps = defaultDeps,
): void {
  deps.startBacklog({
    jobPlatform: jobPlatformForCollection(platform),
    itemPlatform: platform,
    capability,
  });
}
