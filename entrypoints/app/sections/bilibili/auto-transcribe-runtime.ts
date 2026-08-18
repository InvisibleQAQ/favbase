import {
  AutoTranscribePipeline,
  type AutoTranscribeSession,
} from '@/lib/auto-transcribe/pipeline';
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
import type { CooperativeCheckpoint } from '@/lib/collections';

import { startJob } from '../../hooks/background-jobs-store';
import { enqueueBiliCollectionProcessing } from './bilibili-processing-adapter';

const PLATFORM = 'bilibili';

export const biliAutoTranscribePipeline = new AutoTranscribePipeline(
  createBiliAutoTranscribeAdapter({ startProcessing: enqueueBiliCollectionProcessing }),
);

let transcriptTail: Promise<void> = Promise.resolve();

function toAutoTranscribeVideo(video: BiliFavVideo): AutoTranscribeVideo {
  return {
    videoId: video.bvid,
    title: video.title,
    cover: normalizeCover(video.cover),
    author: video.upper.name,
    duration: video.duration,
  };
}

async function dispatchTranscriptSession(session: AutoTranscribeSession): Promise<void> {
  // 'queue' parks the session behind whatever holds the shared
  // 'bilibili:transcribe' key (a manual per-video run) and starts it at
  // settlement — the store owns the redispatch that used to be a loop here.
  await startJob(PLATFORM, 'transcribe', async (setProgress, control) => {
    const publishProgress = (): void => {
      const state = biliAutoTranscribePipeline.getSnapshot();
      if (state.totalVideos > 0) {
        setProgress({ done: state.currentIndex, total: state.totalVideos });
      }
    };
    const unsubscribe = biliAutoTranscribePipeline.subscribe(publishProgress);
    publishProgress();
    try {
      await session.run(control);
    } finally {
      unsubscribe();
    }
  }, 'queue').settled;
}

interface TranscriptProducer {
  append(videos: readonly BiliFavVideo[]): void;
  close(): void;
}

function createTranscriptProducer(): TranscriptProducer {
  let queued: AutoTranscribeVideo[] = [];
  let session: AutoTranscribeSession | null = null;
  let closed = false;
  let scheduled = false;

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    const previous = transcriptTail;
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        session = biliAutoTranscribePipeline.createSession();
        session.append(queued);
        queued = [];
        if (closed) session.close();
        await dispatchTranscriptSession(session);
      });
    transcriptTail = run.catch((error) => {
      console.error('[auto-transcribe] session dispatch failed:', error);
    });
  };

  return {
    append(videos) {
      if (closed) return;
      const accepted = videos
        .filter((video) => video.attr !== 9 && Boolean(video.bvid))
        .map(toAutoTranscribeVideo);
      if (accepted.length === 0) return;
      if (session) session.append(accepted);
      else queued.push(...accepted);
      schedule();
    },
    close() {
      if (closed) return;
      closed = true;
      session?.close();
    },
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
  const producer = createTranscriptProducer();
  try {
    return await syncAllFavoriteVideos(
      folders,
      onProgress,
      control,
      (videos) => producer.append(videos),
    );
  } finally {
    producer.close();
  }
}
