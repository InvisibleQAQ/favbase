import { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import type { AutoTranscribeVideo } from '@/lib/auto-transcribe/types';
import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';
import {
  syncAllFavoriteVideos,
  type BiliFavoritesSyncProgress,
} from '@/lib/bilibili/bili-sync-service';
import type {
  FavoriteVideosSyncResult,
} from '@/lib/bilibili/favorites-sync-runner';
import type { BiliFavFolder, BiliFavVideo } from '@/lib/bilibili/types';
import { normalizeCover } from '@/lib/bilibili/url-utils';
import { isProcessableVideo } from '@/lib/bilibili/video-eligibility';
import type { CooperativeCheckpoint } from '@/lib/collections';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { createTranscriptLane } from '../../hooks/transcript-lane';
import { enqueueBiliCollectionProcessing } from './bilibili-processing-adapter';

const JOB_PLATFORM = jobPlatformForCollection('bilibili');

export const biliAutoTranscribePipeline = new AutoTranscribePipeline(
  createBiliAutoTranscribeAdapter({ startProcessing: enqueueBiliCollectionProcessing }),
);

// The producer / dispatch mechanics (one serial session per Fetch producer,
// 'queue' behind a manual run, later producers behind the active session)
// are the shared lane's; eligibility and the mapping below stay here.
const lane = createTranscriptLane(biliAutoTranscribePipeline, JOB_PLATFORM);

function toAutoTranscribeVideo(video: BiliFavVideo): AutoTranscribeVideo {
  return {
    videoId: video.bvid,
    title: video.title,
    cover: normalizeCover(video.cover),
    author: video.upper.name,
    duration: video.duration,
  };
}

/**
 * Run one Bilibili Fetch producer. Every durably inserted page batch is
 * published into the same Transcript inbox; Fetch never awaits Transcript.
 */
export async function runBiliStreamingSync(
  folders: BiliFavFolder[],
  onProgress?: (progress: BiliFavoritesSyncProgress) => void,
  control?: CooperativeCheckpoint,
): Promise<FavoriteVideosSyncResult> {
  const producer = lane.createProducer();
  try {
    return await syncAllFavoriteVideos(
      folders,
      onProgress,
      control,
      (videos) => producer.append(
        videos
          .filter((video) => isProcessableVideo(video) && Boolean(video.bvid))
          .map(toAutoTranscribeVideo),
      ),
    );
  } finally {
    producer.close();
  }
}
