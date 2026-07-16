/**
 * X (Twitter) sync message contracts + structured sync-error classification.
 *
 * Two trigger surfaces drive the SAME `syncBookmarks` domain op:
 *   1. app.html `/collections/x` manual button — runs in the page context.
 *   2. x.com `/i/bookmarks` on-page floating button (content script) — the
 *      button can't reach PGlite (port-bridge rejects content scripts) nor read
 *      the webRequest-captured auth (storage.session is trusted-context only),
 *      so it delegates to the Offscreen document via the background SW. The
 *      offscreen document has no chrome.storage either, so the SW resolves
 *      `getXAuth()` and ships the auth inside the OFFSCREEN_X_SYNC message:
 *
 *        CS  --X_SYNC_START-->  bg  --OFFSCREEN_X_SYNC{auth}-->  offscreen
 *        offscreen (runs syncBookmarks) --OFFSCREEN_X_SYNC_PROGRESS--> bg
 *        bg --X_SYNC_PUSH--> CS (floating UI state machine)
 *
 * This mirrors the transcription pipeline's CS→bg→offscreen→tab routing.
 *
 * The i18n seam stays at the UI boundary: this module emits the structured
 * `XSyncError` (auth / rate-limit / unknown); each consumer (app.html view OR
 * the content-script toast) maps kinds → locale keys itself.
 */

import { XAuthError, XRateLimitError, type XAuthFailReason } from './x-api';
import type { SyncBookmarksResult } from './x-sync-service';

/**
 * Structured sync error — consumers map kinds to locale keys (i18n at UI).
 * Auth carries the failure mode because the user action differs: 'no-token'
 * (nothing captured yet → refresh x.com) vs 'rejected' (X returned 401/403 on
 * our replay → re-login). Collapsing them into one message made real failures
 * undiagnosable (2026-07 "Refresh x.com and retry" dead end).
 */
export type XSyncError =
  | { kind: 'auth'; reason: XAuthFailReason }
  | { kind: 'rate-limit'; resetAt: Date | null }
  | { kind: 'unknown'; message: string };

/** Map a thrown sync error to the structured, serializable `XSyncError`. */
export function classifyXSyncError(err: unknown): XSyncError {
  if (err instanceof XAuthError) return { kind: 'auth', reason: err.reason };
  if (err instanceof XRateLimitError) return { kind: 'rate-limit', resetAt: err.resetAt };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

// ---------------------------------------------------------------------------
// Wire messages
// ---------------------------------------------------------------------------

/** Content script → background: user clicked the on-page "fetch bookmarks" button. */
export interface XSyncStartMessage {
  type: 'X_SYNC_START';
}

/**
 * Background → content script (tab push): sync lifecycle for the floating UI.
 * `fetching` streams the running fetched count (total is unknowable with cursor
 * pagination, so the UI shows N + page); `done`/`error` are terminal.
 */
export type XSyncPush =
  | { type: 'X_SYNC_PUSH'; phase: 'fetching'; fetchedCount: number; page: number }
  | { type: 'X_SYNC_PUSH'; phase: 'done'; result: SyncBookmarksResult }
  | { type: 'X_SYNC_PUSH'; phase: 'error'; error: XSyncError };
