import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  STORAGE_KEYS.sidebarPinned,
  { fallback: true },
);

export type LocalePreference = 'auto' | 'zh-CN' | 'en';

export const localeStorage = storage.defineItem<LocalePreference>(
  STORAGE_KEYS.locale,
  { fallback: 'auto' },
);

/** Summary of the most recent successful X bookmarks sync. */
export interface XLastSync {
  /** Epoch ms of the successful sync. */
  syncedAt: number;
  /** Items newly inserted that run (the "N new this run" count). */
  inserted: number;
}

// Persists the last X sync summary so the "N new this run" caption survives an
// app.html reload. Only the X collection section writes/reads it. `null` =
// never synced through this feature (legacy) → caption omits the "new" segment.
export const xLastSyncStorage = storage.defineItem<XLastSync | null>(
  STORAGE_KEYS.xLastSync,
  { fallback: null },
);
