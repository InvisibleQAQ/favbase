import { useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { extractPendingBookmarks } from '@/lib/bookmarks/bookmark-content-service';
import { countPendingExtractions } from '@/lib/bookmarks/bookmarks-sync-service';
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';

import { startJob, useJob } from '../../hooks/background-jobs-store';

export interface BookmarkExtractionState {
  running: boolean;
  /** Items settled this run (all outcomes). */
  done: number;
  /** Pending backlog measured at run start. */
  total: number;
  current: { url: string; title: string } | null;
  pendingCount: number | null;
  pendingCountError: string | null;
  start: () => void;
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
// Deliberately no AbortSignal: closing app.html kills the page anyway, and the
// pending queue resumes on the next open. Each successfully chunked item is fed
// to auto-tag + auto-embed per item (not at run end) so a mid-run page close
// can't orphan chunked-but-never-embedded items — chunked items are never
// re-picked. Those per-item embed/tag stay fire-and-forget (void) and are NOT
// registered as separate jobs: their total is unknowable upfront and a run-end
// batch would regress this orphan-safety.
// ---------------------------------------------------------------------------

/**
 * Kick off the serial content-extraction worker as the `bookmarks:sync` job.
 * Re-entrant safe via startJob's running guard (cross-mount dedupe).
 */
export function startBookmarkExtraction(): void {
  startJob('bookmarks', 'sync', async (setProgress) => {
    const db = await initDbProxy(); // idempotent — joins the in-flight init
    await extractPendingBookmarks({
      db,
      onProgress: ({ done, total }) => setProgress({ done, total }),
      onItemExtracted: (id) => {
        // Same triggers + call convention as the other platforms' sync
        // wrap-up (use-github-stars syncFn): app.html context only — the
        // tagging/embedding import chains need chrome.storage. Per-item (not
        // run-end) to keep the orphan-safety noted above.
        void tagNewItems('bookmarks', [id]);
        void embedNewItems('bookmarks', [id]);
      },
    });
  });
}

/** Subscribe to the extraction progress (drives the view caption). */
export function useBookmarkExtraction(refreshKey?: unknown): BookmarkExtractionState {
  const job = useJob('bookmarks', 'sync');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingCountError, setPendingCountError] = useState<string | null>(null);
  const p = job?.progress as
    | { done: number; total: number; current?: { url: string; title: string } }
    | null
    | undefined;

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
    running: job?.running ?? false,
    done: p?.done ?? 0,
    total: p?.total ?? 0,
    current: p?.current ?? null,
    pendingCount,
    pendingCountError,
    start: startBookmarkExtraction,
  };
}
