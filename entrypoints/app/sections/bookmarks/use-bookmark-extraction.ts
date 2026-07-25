import { useEffect, useState, useSyncExternalStore } from 'react';

import { initDbProxy } from '@/lib/database';
import { extractPendingBookmarks } from '@/lib/bookmarks/bookmark-content-service';
import { countPendingExtractions } from '@/lib/bookmarks/bookmarks-sync-service';
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';

import {
  getJob,
  startJob,
  trackJobRun,
  useJob,
  type BackgroundJob,
} from '../../hooks/background-jobs-store';
import {
  beginExtractionRun,
  deriveExtractionPhase,
  finishExtractionRun,
  getExtractionControlSnapshot,
  recordExtractionProgress,
  requestExtractionPause,
  subscribeExtractionControl,
  type ExtractionPhase,
} from './bookmark-extraction-control';

export interface BookmarkExtractionState {
  running: boolean;
  phase: ExtractionPhase;
  pausing: boolean;
  paused: boolean;
  /** Items settled this run (all outcomes). */
  done: number;
  /** Pending backlog measured at run start. */
  total: number;
  current: { url: string; title: string } | null;
  pendingCount: number | null;
  pendingCountError: string | null;
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
}

// ---------------------------------------------------------------------------
// Content extraction now runs through the shared backgroundJobs store as a
// single `bookmarks:sync` job (the bespoke module-level singleton was folded
// into that store). Two payoffs from consolidating: the run counts in the
// global "don't close this page" reminder (useRunningJobs), and startJob's
// running guard dedupes across mounts (navigating away/back re-subscribes to
// the SAME in-flight run instead of starting a second one — module scope
// survives Hash-Router route switches inside app.html).
//
// Pause uses a module-scoped AbortController. The worker checks it between
// items, so the in-flight fetch/extract/write settles before the run yields.
// Each successfully chunked item is fed
// to auto-tag + auto-embed per item (not at run end) so a mid-run page close
// can't orphan chunked-but-never-embedded items — chunked items are never
// re-picked. The work stays fire-and-forget for extraction, while trackJobRun
// observes each independent lane without changing that orphan-safety.
// ---------------------------------------------------------------------------

/**
 * Kick off the serial content-extraction worker as the `bookmarks:sync` job.
 * Re-entrant safe via startJob's running guard (cross-mount dedupe).
 */
export function startBookmarkExtraction(): void {
  if (getJob('bookmarks', 'sync')?.running) return;
  const signal = beginExtractionRun();
  startJob('bookmarks', 'sync', async (setProgress) => {
    try {
      const db = await initDbProxy(); // idempotent — joins the in-flight init
      await extractPendingBookmarks({
        db,
        signal,
        onProgress: (progress) => {
          recordExtractionProgress(progress);
          setProgress(progress);
        },
        onItemExtracted: (id) => {
          // Same triggers + call convention as the other platforms' sync
          // wrap-up (use-github-stars syncFn): app.html context only — the
          // tagging/embedding import chains need chrome.storage. Per-item (not
          // run-end) to keep the orphan-safety noted above.
          trackJobRun('bookmarks', 'tag', tagNewItems('bookmarks', [id]));
          trackJobRun('bookmarks', 'embed', embedNewItems('bookmarks', [id]));
        },
      });
    } finally {
      finishExtractionRun();
    }
  });
}

/** Subscribe to the extraction progress (drives the view caption). */
export function useBookmarkExtraction(refreshKey?: unknown): BookmarkExtractionState {
  const job = useJob('bookmarks', 'sync');
  const embedJob = useJob('bookmarks', 'embed');
  const tagJob = useJob('bookmarks', 'tag');
  const control = useSyncExternalStore(
    subscribeExtractionControl,
    getExtractionControlSnapshot,
  );
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingCountError, setPendingCountError] = useState<string | null>(null);
  const jobProgress = job?.progress as
    | { done: number; total: number; current?: { url: string; title: string } }
    | null
    | undefined;
  const p = jobProgress ?? control.lastProgress;
  const running = job?.running ?? false;
  const phase = deriveExtractionPhase(running, control);

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
    pausing: phase === 'pausing',
    paused: phase === 'paused',
    done: p?.done ?? 0,
    total: p?.total ?? 0,
    current: p?.current ?? null,
    pendingCount,
    pendingCountError,
    embedJob,
    tagJob,
    start: startBookmarkExtraction,
    pause: requestExtractionPause,
    resume: startBookmarkExtraction,
  };
}
