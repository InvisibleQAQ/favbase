import { useSyncExternalStore } from 'react';

import { initDbProxy } from '@/lib/database';
import { extractPendingBookmarks } from '@/lib/bookmarks/bookmark-content-service';
import { tagNewItems } from '@/lib/tagging';
import { embedNewItems } from '@/lib/embedding';

export interface BookmarkExtractionState {
  running: boolean;
  /** Items settled this run (all outcomes). */
  done: number;
  /** Pending backlog measured at run start. */
  total: number;
}

// ---------------------------------------------------------------------------
// Module-level singleton store (tiny push-model, mirrors the house
// TranscriptionCoordinator pattern). Module scope — NOT hook state — so the
// extraction run survives route changes inside app.html: navigating away
// unmounts the bookmarks view but the worker keeps draining the queue, and
// remounting re-subscribes to the same run instead of starting a second one.
// ---------------------------------------------------------------------------

let state: BookmarkExtractionState = { running: false, done: 0, total: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<BookmarkExtractionState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BookmarkExtractionState {
  return state;
}

/**
 * Kick off the serial content-extraction worker (fire-and-forget, re-entrant
 * safe: a call while a run is active is a no-op). Deliberately no AbortSignal:
 * closing app.html kills the page anyway, and the pending queue resumes on the
 * next open. Each successfully chunked item is fed to auto-tag + auto-embed
 * per item (not at run end) so a mid-run page close can't orphan
 * chunked-but-never-embedded items — chunked items are never re-picked.
 */
export function startBookmarkExtraction(): void {
  if (state.running) return;
  setState({ running: true, done: 0, total: 0 });

  void (async () => {
    const db = await initDbProxy(); // idempotent — joins the in-flight init
    await extractPendingBookmarks({
      db,
      onProgress: ({ done, total }) => setState({ done, total }),
      onItemExtracted: (id) => {
        // Same triggers + call convention as the other platforms' sync
        // wrap-up (use-github-stars syncFn): app.html context only — the
        // tagging/embedding import chains need chrome.storage.
        void tagNewItems('bookmarks', [id]);
        void embedNewItems('bookmarks', [id]);
      },
    });
  })()
    .catch((err) => {
      console.error('[bookmark-extraction] run failed:', err);
    })
    .finally(() => {
      setState({ running: false });
    });
}

/** Subscribe to the singleton extraction progress (drives the view caption). */
export function useBookmarkExtraction(): BookmarkExtractionState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
