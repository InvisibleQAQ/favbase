import { t, formatDateTime, type LocaleKeys } from '@/lib/i18n';

import type { CollectionSyncError } from './collection-sync-error';

/**
 * The i18n seam for a classified sync error (docs/32 Step 4). A platform view
 * declares its copy once as a module-level `SyncErrorCopy` and never writes a
 * switch. The view already subscribes through `useTranslation()`, so a locale
 * switch re-renders it and re-runs this.
 *
 * Separate from `collection-sync-error.ts` only because `@/lib/i18n` touches
 * `chrome.storage` at load; the hooks that classify must not pull it in.
 */
export interface SyncErrorCopy {
  /** Auth failure copy; also used for `'rejected'` unless `authRejected` is given. */
  auth: LocaleKeys;
  /** Only for platforms whose UI tells the two apart (X). */
  authRejected?: LocaleKeys;
  /** Rate limited, reset unknown. */
  rateLimited: LocaleKeys;
  /**
   * Rate limited with a known reset — interpolates `{{reset}}` (formatDateTime).
   * Omit when the platform never reports one.
   */
  rateLimitedUntil?: LocaleKeys;
}

/** User-facing copy for a classified sync error; `'unknown'` stays the raw message. */
export function syncErrorMessage(error: CollectionSyncError, copy: SyncErrorCopy): string {
  switch (error.kind) {
    case 'auth':
      return t(error.reason === 'rejected' && copy.authRejected ? copy.authRejected : copy.auth);
    case 'rate-limit':
      return error.resetAt && copy.rateLimitedUntil
        ? t(copy.rateLimitedUntil, { reset: formatDateTime(error.resetAt.getTime()) })
        : t(copy.rateLimited);
    case 'unknown':
      return error.message;
  }
}
