import { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import { listFoldersWithPending } from '@/lib/bilibili/bili-sync-service';
import { createBiliAutoTranscribeAdapter } from '@/lib/bilibili/auto-transcribe-adapter';
import { initDbProxy } from '@/lib/database';

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
 * Dispatch one auto-transcribe batch covering every given favorite folder
 * (ordered — callers put the viewed folder first) through the shared job store
 * as `bilibili:transcribe`. This is what puts the batch into the global "don't
 * close this page" reminder and under the per-platform library gate
 * (born-paused + pause/resume via the cooperative checkpoint the runner
 * forwards into the pipeline's video loop).
 *
 * Before dispatching, folders are filtered by a local DB query
 * (`listFoldersWithPending`): folders without pending videos never start the
 * pipeline (which would re-crawl their pages), and an all-caught-up call
 * dispatches NO job at all — this makes the mount continuation free in steady
 * state (a few DB reads, zero network). A failed lookup only logs: this is
 * opportunistic automation, the next trigger retries.
 *
 * Kind decision: the manual single-video path (use-video-transcribe) shares the
 * `bilibili:transcribe` key but is observation-only (it wraps an ALREADY
 * STARTED promise, so startJob's dedupe never blocks the transcription itself).
 * When that observation currently owns the key, the batch — opportunistic
 * automation — waits for it to settle and then re-dispatches (re-filtering).
 * The pipeline's own isActive guard keeps the retry from ever stacking a
 * second batch.
 */
export function startBiliAutoTranscribe(folderIds: readonly string[]): void {
  if (biliAutoTranscribePipeline.isActive()) return;
  void dispatchAutoTranscribe(folderIds);
}

async function dispatchAutoTranscribe(folderIds: readonly string[]): Promise<void> {
  let targets: string[];
  try {
    await initDbProxy(); // idempotent — joins the in-flight init
    targets = await listFoldersWithPending(folderIds);
  } catch (err) {
    console.error('[auto-transcribe] pending-folder lookup failed:', err);
    return;
  }
  if (targets.length === 0) return;

  const handle = startJob(PLATFORM, 'transcribe', async (setProgress, control) => {
    const unsubscribe = biliAutoTranscribePipeline.subscribe(() => {
      const s = biliAutoTranscribePipeline.getSnapshot();
      // Per-folder progress: {done,total} resets when the run moves to the
      // next folder (accepted — the pipeline reports one folder at a time).
      if (s.totalVideos > 0) setProgress({ done: s.currentIndex, total: s.totalVideos });
    });
    try {
      for (const folderId of targets) {
        await biliAutoTranscribePipeline.start(folderId, control);
        const phase = biliAutoTranscribePipeline.getSnapshot().phase;
        // A still-active ASR quota guard or a cancel applies to every
        // remaining folder too — stop instead of hitting the same wall N times.
        if (phase === 'quota_paused' || phase === 'cancelled') return;
      }
    } finally {
      unsubscribe();
    }
  });
  if (!handle.started) {
    void handle.settled.then(() => startBiliAutoTranscribe(folderIds));
  }
}
