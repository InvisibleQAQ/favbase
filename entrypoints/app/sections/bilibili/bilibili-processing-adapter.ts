import type { StartTranscribeProcessing } from '@/lib/bilibili/transcribe-utils';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { enqueueCollectionProcessingItem } from '../../hooks/collection-processing-jobs';

const PLATFORM = 'bilibili';
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

export const enqueueBiliCollectionProcessing: StartTranscribeProcessing = (itemId) =>
  enqueueCollectionProcessingItem({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: PLATFORM,
    itemId,
  });
