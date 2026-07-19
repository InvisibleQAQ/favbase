/**
 * X (Twitter) structured sync-error classification.
 *
 * X sync has a single trigger surface: the app.html `/collections/x` manual
 * button, which runs `syncBookmarks` in the page context (it can read the
 * webRequest-captured auth via `getXAuth()` and reach PGlite via the RPC proxy).
 *
 * The i18n seam stays at the UI boundary: this module emits the structured
 * `XSyncError` (auth / rate-limit / unknown); the app.html view maps kinds →
 * locale keys itself.
 */

import { XAuthError, XRateLimitError, type XAuthFailReason } from './x-api';

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
