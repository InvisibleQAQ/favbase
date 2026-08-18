import { useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import {
  extractPendingBookmarks,
  type ExtractionProgress,
} from '@/lib/bookmarks/bookmark-content-service';
import { countPendingExtractions } from '@/lib/bookmarks/bookmarks-sync-service';

import {
  startJob,
  useJob,
  type BackgroundJob,
} from '../../hooks/background-jobs-store';
import { enqueueCollectionProcessingItem } from '../../hooks/collection-processing-jobs';

export type ExtractionPhase = 'idle' | 'running' | 'pausing' | 'paused';

export interface BookmarkExtractionState {
  running: boolean;
  phase: ExtractionPhase;
  /** Items settled this run (all outcomes). */
  done: number;
  /** Pending backlog measured at run start. */
  total: number;
  current: { url: string; title: string } | null;
  pendingCount: number | null;
  pendingCountError: string | null;
  extractJob: BackgroundJob | null;
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
}

// ---------------------------------------------------------------------------
// Content extraction runs through the shared backgroundJobs store as a single
// `bookmarks:extract` job: it counts in the global "don't close this page"
// reminder, dedupes across mounts, and survives Hash-Router route switches.
//
// It auto-chains after every successful bookmark metadata sync (mount
// auto-sync AND the manual fetch button) — there is no start button anymore.
// Pause/resume belongs to the per-platform library gate: the runner forwards
// startJob's cooperative checkpoint into `extractPendingBookmarks`, which
// awaits it before claiming each item (the in-flight item settles first).
// The bespoke AbortController pause store was deleted with the panel buttons.
//
// Each successfully chunked item is fed to auto-tag + auto-embed per item (not
// at run end) so a mid-run page close can't orphan chunked-but-never-embedded
// items — chunked items are never re-picked. The shared session inbox owns the
// independent processing lanes; extraction only enqueues and never waits.
// ---------------------------------------------------------------------------

/**
 * Kick off the serial content-extraction worker as the `bookmarks:extract` job.
 * Re-entrant safe via startJob's running guard (cross-mount dedupe). This is
 * the auto-continuation target — bookmark sync chains it after success.
 */
export function startBookmarkExtraction(): void {
  startJob('bookmarks', 'extract', async (setProgress, control) => {
    const db = await initDbProxy(); // idempotent — joins the in-flight init
    await extractPendingBookmarks({
      db,
      control,
      onProgress: (progress) => setProgress(progress),
      onItemExtracted: (id) => {
        enqueueCollectionProcessingItem({
          jobPlatform: 'bookmarks',
          itemPlatform: 'bookmarks',
          itemId: id,
        });
      },
    });
  });
}

/** Subscribe to the extraction progress (drives the bookmarks progress panel). */
export function useBookmarkExtraction(refreshKey?: unknown): BookmarkExtractionState {
  const job = useJob('bookmarks', 'extract');
  const embedJob = useJob('bookmarks', 'embed');
  const tagJob = useJob('bookmarks', 'tag');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingCountError, setPendingCountError] = useState<string | null>(null);
  // progress is cleared when a run settles; lastProgress keeps the final counts
  // visible (the job store retains it across runs).
  const p = (job?.progress ?? job?.lastProgress) as ExtractionProgress | null | undefined;
  const running = job?.running ?? false;
  // Phase comes straight from the shared job (the library gate drives
  // pausing/paused through the cooperative run control).
  const phase: ExtractionPhase = !running
    ? 'idle'
    : job?.phase === 'pausing'
      ? 'pausing'
      : job?.phase === 'paused'
        ? 'paused'
        : 'running';

  useEffect(() => {
    if (job?.running) return;
    let cancelled = false;
    setPendingCountError(null);
    void initDbProxy()
      .then((db) => countPendingExtractions(db))
      .then((count) => {
        if (!cancelled) setPendingCount(count);
      })
      .catch((err: unknown) => {
        console.error('[bookmarks] pending extraction count failed:', err);
        if (!cancelled) {
          setPendingCount(null);
          setPendingCountError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job?.generation, job?.running, refreshKey]);

  return {
    running,
    phase,
    done: p?.done ?? 0,
    total: p?.total ?? 0,
    current: p?.current ?? null,
    pendingCount,
    pendingCountError,
    extractJob: job,
    embedJob,
    tagJob,
  };
}
