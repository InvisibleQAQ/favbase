import { settingsStorage, localeStorage } from '@/lib/storage';
import { SettingsValidationError } from '@/lib/storage/settings-schema';
import { WebdavClient } from './webdav-client';
import {
  parseRemoteConfig,
  parseRemoteSys,
  RemoteConfigVersionError,
} from './sync-schema';
import { decideConfigSync, canAcquireLock, hashConfig } from './sync-logic';
import { getWebdavConfig, isConfigSyncable } from './sync-config-storage';
import {
  getSyncMeta,
  patchSyncMeta,
  adoptPulledConfig,
  seedConfigClockIfUnset,
  setSyncStatus,
  expectPulledHashes,
} from './sync-meta-storage';
import {
  SYNC_ROOT,
  SYS_PATH,
  CONFIG_PATH,
  CONFIG_VERSION,
} from './constants';
import type { RemoteSys, SyncResult, WebdavErrorCode } from './types';

/**
 * WebDAV sync orchestrator (Background SW only). Phase 1 syncs config
 * (UserSettings + locale) via whole-config LWW under a cross-device lock. The
 * DB sync phases hook into `doSync` where noted.
 *
 * Pure decisions live in sync-logic.ts; this module wires them to the network
 * (webdav-client) and storage (config/meta) edges.
 */

/** In-memory re-entrancy guard — one sync at a time within this SW instance. */
let isSyncing = false;

function genVersion(): string {
  return crypto.randomUUID();
}

/** Map a thrown error to a structured, translatable code. */
function classifyError(err: unknown): { code: WebdavErrorCode; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  if (err instanceof SettingsValidationError) return { code: 'invalid-settings', detail };
  if (err instanceof RemoteConfigVersionError) {
    return { code: 'incompatible-version', detail };
  }
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return { code: 'auth', detail };
  // `webdav` surfaces network failures as TypeError from fetch.
  if (err instanceof TypeError) return { code: 'network', detail };
  return { code: 'unknown', detail };
}

/**
 * Try to take the cross-device lock. Returns the sync_version to release with,
 * or null if another device holds a fresh lock (caller should back off).
 */
async function acquireLock(client: WebdavClient, now: number): Promise<string | null> {
  const sys = parseRemoteSys(await client.getJSON<unknown>(SYS_PATH));
  if (!canAcquireLock(sys, now)) return null;
  const version = sys?.sync_version || genVersion();
  const next: RemoteSys = {
    lock_status: 'locked',
    lock_timestamp: now,
    sync_version: version,
    last_sync_time: sys?.last_sync_time ?? 0,
  };
  await client.putJSON(SYS_PATH, next);
  return version;
}

/** Release the lock and stamp a fresh sync_version + last_sync_time. */
async function releaseLock(client: WebdavClient, now: number): Promise<string> {
  const version = genVersion();
  const next: RemoteSys = {
    lock_status: 'unlocked',
    lock_timestamp: 0,
    sync_version: version,
    last_sync_time: now,
  };
  await client.putJSON(SYS_PATH, next);
  return version;
}

/**
 * Whole-config LWW: pull if remote is newer, push if local is newer, else noop.
 * On pull, the meta baseline (clock + hash) is adopted BEFORE writing local
 * storage so the resulting storage.watch is recognized as our own write and
 * doesn't bump the clock (anti ping-pong — see sync-meta-storage).
 */
async function syncConfig(client: WebdavClient, now: number): Promise<void> {
  const remote = parseRemoteConfig(await client.getJSON<unknown>(CONFIG_PATH));
  const meta = await getSyncMeta();
  const decision = decideConfigSync(meta.localConfigUpdatedAt, remote);

  if (decision === 'pull' && remote) {
    const remoteSettings = remote.settings;
    const remoteHash = hashConfig(remoteSettings, remote.locale);
    // Both writes fire our own storage.watch — register the intermediate
    // (new settings + current locale) and final hashes so the LWW clock isn't
    // spuriously bumped by our own pull. See sync-meta-storage.
    const currentLocale = await localeStorage.getValue();
    expectPulledHashes([hashConfig(remoteSettings, currentLocale), remoteHash]);
    await adoptPulledConfig(remote.updatedAt, remoteHash);
    await settingsStorage.setValue(remoteSettings);
    await localeStorage.setValue(remote.locale);
    return;
  }

  if (decision === 'push') {
    const [settings, locale] = await Promise.all([
      settingsStorage.getValue(),
      localeStorage.getValue(),
    ]);
    const updatedAt = meta.localConfigUpdatedAt || now;
    await client.putJSON(CONFIG_PATH, {
      version: CONFIG_VERSION,
      updatedAt,
      settings,
      locale,
    });
    // A never-noted local config (clock 0) that seeded the remote: record the
    // baseline so subsequent runs settle to noop.
    if (meta.localConfigUpdatedAt === 0) {
      await patchSyncMeta({
        localConfigUpdatedAt: updatedAt,
        lastKnownConfigHash: hashConfig(settings, locale),
      });
    }
  }
}

/**
 * Run one full sync. Safe to call from alarms, startup catch-up, or the UI
 * "Sync now" button. Never throws — always resolves to a SyncResult and writes
 * the UI-facing status.
 */
export async function doSync(): Promise<SyncResult> {
  if (isSyncing) return { ok: true };

  const config = await getWebdavConfig();
  if (!isConfigSyncable(config)) return { ok: true };

  isSyncing = true;
  const now = Date.now();
  const meta = await getSyncMeta();
  await setSyncStatus({
    state: 'syncing',
    lastSyncTime: meta.lastSyncTime,
    syncVersion: meta.syncVersion,
  });

  const client = new WebdavClient(config);
  let acquiredVersion: string | null = null;
  try {
    await seedConfigClockIfUnset();
    await client.ensureDirectory(SYNC_ROOT);

    acquiredVersion = await acquireLock(client, now);
    if (!acquiredVersion) {
      // Another device is mid-sync — back off, leave status idle (not an error).
      await setSyncStatus({
        state: 'idle',
        lastSyncTime: meta.lastSyncTime,
        syncVersion: meta.syncVersion,
      });
      return { ok: false, errorCode: 'locked' };
    }

    await syncConfig(client, now);
    // Phase 2/3 hook: await syncDatabase(client, now) goes here.

    const version = await releaseLock(client, now);
    await patchSyncMeta({ lastSyncTime: now, syncVersion: version });
    await setSyncStatus({ state: 'idle', lastSyncTime: now, syncVersion: version });
    return { ok: true };
  } catch (err) {
    const { code, detail } = classifyError(err);
    console.error('[favbase webdav] sync failed', code, detail);
    if (acquiredVersion) {
      // Best-effort unlock so a failure doesn't strand the lock for 10 min.
      await releaseLock(client, now).catch(() => {});
    }
    await setSyncStatus({
      state: 'error',
      lastSyncTime: meta.lastSyncTime,
      syncVersion: meta.syncVersion,
      errorCode: code,
      errorDetail: detail,
    });
    return { ok: false, errorCode: code, errorDetail: detail };
  } finally {
    isSyncing = false;
  }
}

/**
 * Escape hatch: delete the entire remote /FavbaseSync tree, then reset local
 * sync bookkeeping so a later sync re-seeds cleanly. Refuses while a sync runs.
 */
export async function clearRemote(): Promise<SyncResult> {
  if (isSyncing) return { ok: false, errorCode: 'locked' };
  const config = await getWebdavConfig();
  if (!config.url || !config.username || !config.password) {
    return { ok: false, errorCode: 'unknown', errorDetail: 'incomplete config' };
  }
  try {
    await new WebdavClient(config).deletePath(SYNC_ROOT);
    await patchSyncMeta({ syncVersion: '', lastSyncTime: 0 });
    await setSyncStatus({ state: 'idle', lastSyncTime: 0, syncVersion: '' });
    return { ok: true };
  } catch (err) {
    const { code, detail } = classifyError(err);
    return { ok: false, errorCode: code, errorDetail: detail };
  }
}
