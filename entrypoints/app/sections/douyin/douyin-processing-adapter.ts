import type { StartTranscribeProcessing } from '@/lib/transcription/transcribe-and-persist';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { enqueueCollectionProcessingItem } from '../../hooks/collection-processing-jobs';

const PLATFORM = 'douyin';
const JOB_PLATFORM = jobPlatformForCollection(PLATFORM);

/**
 * The app / lib seam for Douyin's Embed / Tag lanes: `itemId` is the
 * platformItemId (`aweme_id`), which the lanes resolve against
 * `items.platform_item_id`. Shared by the per-page sync dispatch (image posts,
 * healed ghosts) and the transcription seam (a transcribed video), so the
 * domain layer never depends on the app's job store.
 */
export const enqueueDouyinCollectionProcessing: StartTranscribeProcessing = (itemId) =>
  enqueueCollectionProcessingItem({
    jobPlatform: JOB_PLATFORM,
    itemPlatform: PLATFORM,
    itemId,
  });
