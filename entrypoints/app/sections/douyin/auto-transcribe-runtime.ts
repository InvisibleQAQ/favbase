import { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import type { AutoTranscribeVideo } from '@/lib/auto-transcribe/types';
import { createDouyinAutoTranscribeAdapter } from '@/lib/douyin/auto-transcribe-adapter';
import {
  getDouyinPendingVideos,
  syncDouyinCollections,
  type DouyinPendingVideo,
  type DouyinTransport,
  type SyncDouyinOptions,
  type SyncDouyinResult,
} from '@/lib/douyin/douyin-sync-service';

import { jobPlatformForCollection } from '../../hooks/collection-job-platform';
import { createTranscriptLane } from '../../hooks/transcript-lane';
import { enqueueDouyinCollectionProcessing } from './douyin-processing-adapter';

const JOB_PLATFORM = jobPlatformForCollection('douyin');

export const douyinAutoTranscribePipeline = new AutoTranscribePipeline(
  createDouyinAutoTranscribeAdapter({ startProcessing: enqueueDouyinCollectionProcessing }),
);

const lane = createTranscriptLane(douyinAutoTranscribePipeline, JOB_PLATFORM);

/** `AutoTranscribeVideo.duration` is seconds; `cover` is a string (null → ''). */
function toAutoTranscribeVideo(video: DouyinPendingVideo): AutoTranscribeVideo {
  return {
    videoId: video.awemeId,
    title: video.title,
    cover: video.coverUrl ?? '',
    author: video.authorName,
    duration: video.durationMs === null ? 0 : Math.round(video.durationMs / 1000),
  };
}

/**
 * One Douyin Fetch producer (docs/37 Step 3). Each persisted page's newly
 * inserted transcribable videos go straight into the Transcript inbox; once
 * the sync itself succeeded, the platform's whole 'pending' backlog is
 * appended too (D7: a session lost with a closed app.html is caught up here —
 * the session dedupes by id, so this run's own videos are not queued twice).
 * The backlog is skipped when an earlier Douyin session was still active at
 * entry (see below). A failed sync appends no backlog: whatever stopped it (a
 * verification page, a closed tab) would stop the transcription too. Fetch
 * never awaits Transcript; the producer closes in `finally`, so a failed sync
 * still drains what it published.
 */
export async function runDouyinStreamingSync(
  transport: DouyinTransport,
  opts: Omit<SyncDouyinOptions, 'onVideosPending'>,
): Promise<SyncDouyinResult> {
  // Judged at entry, before this run creates anything. An earlier session
  // still draining already holds every item the backlog would add, except
  // what a FAILED earlier sync never appended. Reading the backlog now would
  // hand the next session a list that goes stale while it waits behind the
  // earlier one, replaying finished items: a cache hit, but a content
  // rewrite, a chunk replace that wipes the embeddings, a re-embed and a
  // 10–15 s wait each. Cost accepted: leftovers from a failed earlier sync
  // wait for the next sync that starts with no session running.
  const earlierSessionActive = douyinAutoTranscribePipeline.isActive();
  const producer = lane.createProducer();
  try {
    const result = await syncDouyinCollections(transport, {
      ...opts,
      onVideosPending: (videos) => producer.append(videos.map(toAutoTranscribeVideo)),
    });
    if (earlierSessionActive) return result;
    try {
      producer.append((await getDouyinPendingVideos()).map(toAutoTranscribeVideo));
    } catch (error) {
      // The sync succeeded; a failed backlog read must not turn it into a
      // failed Platform Sync.
      console.error('[douyin-auto-transcribe] pending backlog read failed:', error);
    }
    return result;
  } finally {
    producer.close();
  }
}
