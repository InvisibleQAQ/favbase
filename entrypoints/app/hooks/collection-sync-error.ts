import {
  PlatformAuthError,
  PlatformRateLimitError,
  type AuthFailReason,
} from '@/lib/collections/sync-errors';

/**
 * A failed Collection Platform sync (or Bilibili browse), classified by base
 * class alone (docs/32 Step 4). Every variant keeps the raw English `message`:
 * a platform with neither auth nor rate limits (bookmarks) shows it verbatim,
 * and `'unknown'` is exactly that message.
 *
 * Deliberately i18n-free: `useCollectionLibrary` and the Bilibili hooks import
 * this module, and `@/lib/i18n` touches `chrome.storage` at load. The copy half
 * is `collection-sync-error-message.ts`, imported by views only.
 */
export type CollectionSyncError =
  | { kind: 'auth'; reason: AuthFailReason; message: string }
  | { kind: 'rate-limit'; resetAt: Date | null; message: string }
  | { kind: 'unknown'; message: string };

/** The one classifier: base class → kind. Knows no platform. */
export function classifyCollectionSyncError(err: unknown): CollectionSyncError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof PlatformAuthError) return { kind: 'auth', reason: err.reason, message };
  if (err instanceof PlatformRateLimitError) {
    return { kind: 'rate-limit', resetAt: err.resetAt, message };
  }
  return { kind: 'unknown', message };
}

/**
 * Ms until a rate-limit error's reset — 0 when the error is not a rate limit,
 * carries no reset, or the reset has passed. Pure; drives the Fetch-button
 * lock through `useCountdown`.
 */
export function rateLimitRemainingMs(error: CollectionSyncError | null, now: number): number {
  if (error?.kind !== 'rate-limit' || error.resetAt === null) return 0;
  return Math.max(0, error.resetAt.getTime() - now);
}
