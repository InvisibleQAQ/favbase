/**
 * Offscreen X bookmarks sync runner. The offscreen document holds PGlite
 * directly (`getDb()` → local instance) but has NO `chrome.storage` (offscreen
 * documents only get chrome.runtime messaging), so it CANNOT read the
 * webRequest-captured auth itself — the background SW resolves `getXAuth()`
 * and ships it inside the OFFSCREEN_X_SYNC message. This runner then executes
 * the whole atomic `syncBookmarks` op on behalf of the x.com content-script
 * button, streaming progress back to the background SW (which routes it to
 * the originating tab).
 */

import { initDbMain } from '@/lib/database/db';
import type { XAuth } from '@/lib/x/x-auth';
import { syncBookmarks, type SyncBookmarksResult } from '@/lib/x/x-sync-service';
import { classifyXSyncError, type XSyncError } from '@/lib/x/x-messages';

export type XSyncOffscreenResult =
  | { success: true; result: SyncBookmarksResult }
  | { success: false; error: XSyncError };

export async function runXSync(sessionId: string, auth: XAuth): Promise<XSyncOffscreenResult> {
  try {
    // getDb() throws until PGlite is ready; initDbMain() is idempotent (returns
    // the completed/in-flight instance) so this just awaits readiness.
    await initDbMain();

    const result = await syncBookmarks(auth, (fetchedCount, page) => {
      // Fire-and-forget; a transient no-receiver (SW cold-start) must not abort
      // the sync. The background listener is registered at SW startup.
      chrome.runtime
        .sendMessage({ type: 'OFFSCREEN_X_SYNC_PROGRESS', sessionId, fetchedCount, page })
        .catch(() => {});
    });

    return { success: true, result };
  } catch (err) {
    return { success: false, error: classifyXSyncError(err) };
  }
}
