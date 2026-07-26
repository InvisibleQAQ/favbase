/**
 * WebDAV sync — shared constants (remote layout, lock, scheduler).
 *
 * Remote directory layout under the user's WebDAV server:
 *   /FavbaseSync
 *     ├── sys.json      — lock + version metadata (cross-device mutex)
 *     ├── config.json   — UserSettings + locale (Phase 1)
 *     └── db/           — knowledge base tables (Phase 2/3, not yet written)
 */

/** Root directory created on the user's WebDAV server. */
export const SYNC_ROOT = '/FavbaseSync';

export const SYS_PATH = `${SYNC_ROOT}/sys.json`;
export const CONFIG_PATH = `${SYNC_ROOT}/config.json`;

/**
 * A stale lock older than this is force-stolen. Guards against a device that
 * crashed mid-sync leaving `sys.json` locked forever. Must comfortably exceed a
 * normal sync's wall-clock (config sync is sub-second; the margin is for the
 * DB sync phases and slow WebDAV servers).
 */
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** chrome.alarms names — one periodic, one debounced-on-change. */
export const ALARM_PERIODIC = 'webdav-periodic-sync';
export const ALARM_DEBOUNCE = 'webdav-debounce-sync';

/** Background auto-sync cadence (minutes). MV3 SWs sleep — must use alarms. */
export const PERIODIC_MINUTES = 30;
/** Debounce window after a local config change before auto-syncing (minutes). */
export const DEBOUNCE_MINUTES = 5;

/** Remote payload schema version (bumped when config.json shape changes). */
export const CONFIG_VERSION = 1;
