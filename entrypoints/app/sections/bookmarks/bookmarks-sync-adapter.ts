import { syncBookmarks } from '@/lib/bookmarks/bookmarks-sync-service';
import type { CooperativeCheckpoint } from '@/lib/collections';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'bookmarks';

/** Metadata-sync progress — the bookmark tree has no upfront total. */
export interface BookmarksSyncProgress {
  done: number;
  total: number | null;
}

/**
 * The bookmarks platform Sync Adapter — the single implementation of what a
 * bookmarks sync means: the local `chrome.bookmarks` tree sync through the
 * Platform Sync funnel (attempt record + backlog embed dispatch), then the
 * chained content-extraction stage. Both the manual page (mount auto-sync +
 * fetch button) and the daily auto-sync coordinator run this exact function.
 * Local browser data — no auth to resolve, so every run is an attempt.
 */
export async function runBookmarksSync(
  onProgress: (progress: BookmarksSyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  onProgress({ done: 0, total: null });
  // Empty ids = backlog-only dispatch, no tag lane: the funnel still drains
  // the embed backlog, because bookmarks left 'chunked' by an interrupted
  // earlier run are not re-picked by extraction (it only sees 'pending').
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncBookmarks(control);
    onProgress({ done: result.totalBookmarks, total: null });
    return { fetched: result.totalBookmarks, inserted: result.inserted, newItemIds: [] };
  });
  // Chain the content-extraction worker after new bookmarks land as 'pending'
  // — only after a successful sync, and outside the funnel: it fetches web
  // pages, it does not contact the platform. Fire-and-forget module singleton
  // — survives route changes, its startJob guard dedupes concurrent starts,
  // and the library gate can pause it. The dynamic import keeps the
  // extraction worker (defuddle/linkedom) in the lazy bookmarks chunk instead
  // of the eager app boot chunk; ESM modules are singletons, so this is the
  // same instance the bookmarks section uses.
  const { startBookmarkExtraction } = await import('./use-bookmark-extraction');
  startBookmarkExtraction();
}

/** Daily auto-sync trigger policy: local browser data — always ready. */
export const bookmarksAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => true,
};
