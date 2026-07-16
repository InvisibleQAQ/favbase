/**
 * X (Twitter) bookmarks sync handlers (background SW side).
 *
 * The x.com `/i/bookmarks` content-script button can't reach PGlite or the
 * captured auth, so it delegates the sync to the Offscreen document and relies
 * on the background SW to route progress/terminal state back to its tab:
 *
 *   CS --X_SYNC_START--> [handleXSyncStart] --OFFSCREEN_X_SYNC--> offscreen
 *   offscreen --OFFSCREEN_X_SYNC_PROGRESS--> [handleXSyncProgress] --X_SYNC_PUSH--> CS
 *
 * Mirrors `transcription-handlers.ts` (session→tab routing via BackgroundContext).
 */

import type { BackgroundContext } from './types';
import type { MessageSender } from './transcription-utils';
import { getXAuth } from '@/lib/x/x-auth';
import type { XSyncStartMessage } from '@/lib/x/x-messages';
import type { OffscreenXSyncProgressMessage } from '@/lib/offscreen/types';
import type { XSyncOffscreenResult } from '@/lib/offscreen/x-sync';

/**
 * Kick off an X sync in the Offscreen document on behalf of the on-page button.
 * Streams a terminal `X_SYNC_PUSH` (done/error) back to the originating tab;
 * `handleXSyncProgress` streams the `fetching` updates in between.
 */
export async function handleXSyncStart(
  _msg: XSyncStartMessage,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<{ success: boolean }> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { success: false };

  // Resolve the captured auth HERE: the offscreen document has no
  // chrome.storage (runtime messaging only), so the SW — which is also the
  // webRequest writer of these tokens — reads them and ships them along.
  const auth = await getXAuth();
  if (!auth) {
    console.warn(
      '[favbase x-sync] no captured X auth in session storage — the x.com page must fire an API request (refresh it) before the extension can capture the login session',
    );
    ctx.sendToTab(tabId, {
      type: 'X_SYNC_PUSH',
      phase: 'error',
      error: { kind: 'auth', reason: 'no-token' },
    });
    return { success: false };
  }

  const sessionId = crypto.randomUUID();
  ctx.registerXSyncSession(sessionId, tabId);

  try {
    await ctx.ensureOffscreen();
    const res: XSyncOffscreenResult = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_X_SYNC',
      sessionId,
      auth,
    });

    if (res.success) {
      ctx.sendToTab(tabId, { type: 'X_SYNC_PUSH', phase: 'done', result: res.result });
    } else {
      console.warn('[favbase x-sync] offscreen sync failed:', JSON.stringify(res.error));
      ctx.sendToTab(tabId, { type: 'X_SYNC_PUSH', phase: 'error', error: res.error });
    }
    return { success: res.success };
  } catch (err) {
    ctx.sendToTab(tabId, {
      type: 'X_SYNC_PUSH',
      phase: 'error',
      error: { kind: 'unknown', message: err instanceof Error ? err.message : String(err) },
    });
    return { success: false };
  } finally {
    ctx.unregisterXSyncSession(sessionId);
  }
}

/** Route an offscreen fetch-progress tick to the originating tab's floating UI. */
export function handleXSyncProgress(
  msg: OffscreenXSyncProgressMessage,
  ctx: BackgroundContext,
): void {
  const tabId = ctx.resolveXSyncTab(msg.sessionId);
  if (tabId === null) {
    console.warn(`[handleXSyncProgress] unresolved sessionId=${msg.sessionId}, dropping progress`);
    return;
  }
  ctx.sendToTab(tabId, {
    type: 'X_SYNC_PUSH',
    phase: 'fetching',
    fetchedCount: msg.fetchedCount,
    page: msg.page,
  });
}
