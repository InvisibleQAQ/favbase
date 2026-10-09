import type { AutoTranscribePipeline, AutoTranscribeSession } from '@/lib/auto-transcribe/pipeline';
import type { AutoTranscribeVideo } from '@/lib/auto-transcribe/types';

import { startJob } from './background-jobs-store';

export interface TranscriptProducer {
  /** Publish already-shaped, durably inserted videos into this producer's session. */
  append(videos: readonly AutoTranscribeVideo[]): void;
  /** The Fetch producer is done: the session drains what was published and ends. */
  close(): void;
}

export interface TranscriptLane {
  /** One Fetch producer's handle: the first `append` creates the session and dispatches it; `close` ends the inbox. */
  createProducer(): TranscriptProducer;
}

/**
 * One platform's Transcript lane (docs/37 Step 3, hoisted from the bilibili
 * runtime): a Fetch producer publishes durably inserted videos into ONE serial
 * auto-transcribe session, dispatched as the platform's `transcribe` job with
 * the 'queue' collision — parked behind a manual per-video run, with the job
 * store owning the redispatch. A later producer waits behind the active
 * session: the tail is per lane (= per pipeline instance), never across
 * platforms, so one platform's backlog never delays another's. Eligibility
 * and the video mapping stay in the platform runtime; this only moves
 * already-shaped videos and never awaits them (Fetch never awaits Transcript).
 */
export function createTranscriptLane(
  pipeline: AutoTranscribePipeline,
  jobPlatform: string,
): TranscriptLane {
  let tail: Promise<void> = Promise.resolve();

  async function dispatch(session: AutoTranscribeSession): Promise<void> {
    await startJob(jobPlatform, 'transcribe', async (setProgress, control) => {
      const publishProgress = (): void => {
        const state = pipeline.getSnapshot();
        if (state.totalVideos > 0) {
          setProgress({ done: state.currentIndex, total: state.totalVideos });
        }
      };
      const unsubscribe = pipeline.subscribe(publishProgress);
      publishProgress();
      try {
        await session.run(control);
      } finally {
        unsubscribe();
      }
    }, 'queue').settled;
  }

  return {
    createProducer() {
      let queued: AutoTranscribeVideo[] = [];
      let session: AutoTranscribeSession | null = null;
      let closed = false;
      let scheduled = false;

      const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        const previous = tail;
        const run = previous
          .catch(() => undefined)
          .then(async () => {
            session = pipeline.createSession();
            session.append(queued);
            queued = [];
            if (closed) session.close();
            await dispatch(session);
          });
        tail = run.catch((error) => {
          console.error('[transcript-lane] session dispatch failed:', error);
        });
      };

      return {
        append(videos) {
          if (closed || videos.length === 0) return;
          if (session) session.append(videos);
          else queued.push(...videos);
          schedule();
        },
        close() {
          if (closed) return;
          closed = true;
          session?.close();
        },
      };
    },
  };
}
