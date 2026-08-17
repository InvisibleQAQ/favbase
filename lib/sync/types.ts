import type { UserSettings, LocalePreference } from '@/lib/storage';

/**
 * Local WebDAV connection config (`local:webdav-config`). `password` is stored
 * AES-GCM obfuscated on disk (see crypto.ts) — this type is the DECRYPTED shape
 * that get/setWebdavConfig round-trips. `enabled` gates all background sync.
 */
export interface WebdavConfig {
  enabled: boolean;
  /** WebDAV base URL, e.g. `https://dav.jianguoyun.com/dav/`. https only. */
  url: string;
  username: string;
  password: string;
}

/**
 * LWW bookkeeping (`local:webdav-sync-meta`). `localConfigUpdatedAt` is the
 * Last-Write-Wins clock compared against the remote config's `updatedAt`.
 * `lastKnownConfigHash` dedups real edits from our own pull-writes (anti
 * ping-pong — see sync-meta-storage.noteLocalConfigChange).
 */
export interface WebdavSyncMeta {
  localConfigUpdatedAt: number;
  lastKnownConfigHash: string;
  /** Remote `sync_version` observed at the last successful sync. */
  syncVersion: string;
  /** Epoch ms of the last successful sync (drives startup catch-up gating). */
  lastSyncTime: number;
}

/** UI-facing sync status (`local:webdav-sync-status`), watched by the card. */
export interface WebdavSyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSyncTime: number;
  syncVersion: string;
  /** Structured error code (i18n seam) — UI maps to `settings.sync.err.*`. */
  errorCode?: WebdavErrorCode;
  /** Raw error detail (English debug text) appended to the localized message. */
  errorDetail?: string;
}

/** Structured sync failures. UI translates via `settings.sync.err.<code>`. */
export type WebdavErrorCode =
  | 'network'
  | 'auth'
  | 'locked'
  | 'permission'
  | 'invalid-settings'
  | 'incompatible-version'
  | 'unknown';

/** Remote `config.json` payload (Phase 1). */
export interface RemoteConfig {
  version: number;
  updatedAt: number;
  settings: UserSettings;
  locale: LocalePreference;
}

/** Remote `sys.json` payload (cross-device lock + version). */
export interface RemoteSys {
  lock_status: 'locked' | 'unlocked';
  lock_timestamp: number;
  sync_version: string;
  last_sync_time: number;
}

/** Outcome of a doSync run, returned to the UI over the message bridge. */
export interface SyncResult {
  ok: boolean;
  errorCode?: WebdavErrorCode;
  errorDetail?: string;
}

// ---- Background message bridge (registered in lib/background/messages.ts) ----

/** UI → SW: run a full bidirectional sync now (manual "Sync now" button). */
export interface WebdavSyncNowRequest {
  type: 'WEBDAV_SYNC_NOW';
}

/** UI → SW: delete the entire remote /FavbaseSync tree (escape hatch). */
export interface WebdavClearRemoteRequest {
  type: 'WEBDAV_CLEAR_REMOTE';
}

export type WebdavMessage = WebdavSyncNowRequest | WebdavClearRemoteRequest;
