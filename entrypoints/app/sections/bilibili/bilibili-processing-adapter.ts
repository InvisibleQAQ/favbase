import type { StartTranscribeProcessing } from '@/lib/bilibili/transcribe-utils';

import { enqueueCollectionProcessingItem } from '../../hooks/collection-processing-jobs';

const PLATFORM = 'bilibili';

export const enqueueBiliCollectionProcessing: StartTranscribeProcessing = (itemId) =>
  enqueueCollectionProcessingItem({
    jobPlatform: PLATFORM,
    itemPlatform: PLATFORM,
    itemId,
  });
