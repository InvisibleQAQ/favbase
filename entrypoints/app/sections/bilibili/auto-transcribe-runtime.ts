import { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';

import { startJob } from '../../hooks/background-jobs-store';
import { enqueueBiliCollectionProcessing } from './bilibili-processing-adapter';

const PLATFORM = 'bilibili';

/**
 * Module-level pipeline singleton (NOT a hook ref): the batch run must survive
 * route switches — unmounting the bilibili section no longer aborts it — and it
 * must be reachable with no view mounted (daily auto-sync chains transcription
 * from whatever route is active). The view hook only subscribes.
 */
export const biliAutoTranscribePipeline = new AutoTranscribePipeline(
  createBiliAutoTranscribeAdapter({ startProcessing: enqueueBiliCollectionProcessing }),
);

/**
 * Dispatch one auto-transcribe batch for a favorite folder through the shared
 * job store as `bilibili:transcribe`. This is what puts the batch into the
 * global "don't close this page" reminder and under the per-platform library
 * gate (born-paused + pause/resume via the cooperative checkpoint the runner
 * forwards into the pipeline's video loop).
 *
 * Kind decision: the manual single-video path (use-video-transcribe) shares the
 * `bilibili:transcribe` key but is observation-only (it wraps an ALREADY
 * STARTED promise, so startJob's dedupe never blocks the transcription itself).
 * When that observation currently owns the key, the batch — opportunistic
 * automation — waits for it to settle and then dispatches. The pipeline's own
 * isActive guard keeps the retry from ever stacking a second batch.
 */
export function startBiliAutoTranscribe(collectionId: string): void {
  if (biliAutoTranscribePipeline.isActive()) return;
  const handle = startJob(PLATFORM, 'transcribe', async (setProgress, control) => {
    const unsubscribe = biliAutoTranscribePipeline.subscribe(() => {
      const s = biliAutoTranscribePipeline.getSnapshot();
      if (s.totalVideos > 0) setProgress({ done: s.currentIndex, total: s.totalVideos });
    });
    try {
      await biliAutoTranscribePipeline.start(collectionId, control);
    } finally {
      unsubscribe();
    }
  });
  if (!handle.started) {
    void handle.settled.then(() => startBiliAutoTranscribe(collectionId));
  }
}
