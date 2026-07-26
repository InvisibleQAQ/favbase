import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS, settingsStorage, localeStorage } from '@/lib/storage';
import { hashConfig } from './sync-logic';
import type { WebdavSyncMeta, WebdavSyncStatus } from './types';

const DEFAULT_META: WebdavSyncMeta = {
  localConfigUpdatedAt: 0,
  lastKnownConfigHash: '',
  syncVersion: '',
  lastSyncTime: 0,
};

const metaStorage = storage.defineItem<WebdavSyncMeta>(STORAGE_KEYS.webdavSyncMeta, {
  fallback: DEFAULT_META,
});

const DEFAULT_STATUS: WebdavSyncStatus = {
  state: 'idle',
  lastSyncTime: 0,
  syncVersion: '',
};

const statusStorage = storage.defineItem<WebdavSyncStatus>(STORAGE_KEYS.webdavSyncStatus, {
  fallback: DEFAULT_STATUS,
});

export function getSyncMeta(): Promise<WebdavSyncMeta> {
  return metaStorage.getValue();
}

export async function patchSyncMeta(patch: Partial<WebdavSyncMeta>): Promise<void> {
  const current = await metaStorage.getValue();
  await metaStorage.setValue({ ...current, ...patch });
}

/**
 * Hashes the pull path expects its own storage writes to produce. Because a
 * pull writes settings and locale as TWO separate `setValue`s, the SW's own
 * `storage.watch` fires mid-way on an INTERMEDIATE state (new settings + old
 * locale) whose hash differs from the final remote hash — which would
 * spuriously bump the LWW clock. The engine registers both the intermediate and
 * final hashes here before writing; `noteLocalConfigChange` consumes and skips
 * them. Content-keyed, so it's robust to async watch firing order.
 */
const pullIgnoreHashes = new Set<string>();

/** Engine → mark hashes produced by an imminent pull as our own writes. */
export function expectPulledHashes(hashes: string[]): void {
  pullIgnoreHashes.clear();
  for (const h of hashes) pullIgnoreHashes.add(h);
}

/** Current fingerprint of local settings + locale. */
async function currentConfigHash(): Promise<string> {
  const [settings, locale] = await Promise.all([
    settingsStorage.getValue(),
    localeStorage.getValue(),
  ]);
  return hashConfig(settings, locale);
}

/**
 * Record that local config MAY have changed. Called on every settings/locale
 * write. Bumps the LWW clock ONLY when the content actually differs from the
 * last-known hash — so our own pull-writes (which set `lastKnownConfigHash` to
 * the pulled hash first) are recognized as no-ops and never bump the clock.
 * This content-keyed guard is what prevents pull→bump→push ping-pong, robust to
 * async `storage.watch` firing order.
 */
export async function noteLocalConfigChange(now: number): Promise<boolean> {
  const hash = await currentConfigHash();
  // Our own pull-write (intermediate or final state) — consume and skip.
  if (pullIgnoreHashes.delete(hash)) return false;
  const meta = await metaStorage.getValue();
  if (hash === meta.lastKnownConfigHash) return false;
  await metaStorage.setValue({
    ...meta,
    localConfigUpdatedAt: now,
    lastKnownConfigHash: hash,
  });
  return true;
}

/**
 * One-time seed of the LWW clock from the config's REAL last-edit time
 * (`settings.configSavedAt`), not `now`. This makes first-pairing behave
 * intuitively: a device whose config was edited earlier loses to a remote that
 * was edited later, so a freshly-set-up second device pulls the first device's
 * config instead of clobbering it. A never-saved config seeds to clock 0 → it
 * pulls any existing remote (adopts) and only seeds remote when none exists.
 * Idempotent: no-op once seeded (hash set).
 */
export async function seedConfigClockIfUnset(): Promise<void> {
  const meta = await metaStorage.getValue();
  if (meta.localConfigUpdatedAt !== 0 || meta.lastKnownConfigHash !== '') return;
  const [settings, locale] = await Promise.all([
    settingsStorage.getValue(),
    localeStorage.getValue(),
  ]);
  const saved = Object.values(settings.configSavedAt ?? {}) as number[];
  await metaStorage.setValue({
    ...meta,
    localConfigUpdatedAt: saved.length ? Math.max(...saved) : 0,
    lastKnownConfigHash: hashConfig(settings, locale),
  });
}

/**
 * Mark the just-pulled config as the known baseline: adopt the remote clock and
 * store its hash BEFORE the settings/locale writes' watch callbacks run, so
 * `noteLocalConfigChange` sees a matching hash and skips the bump.
 */
export async function adoptPulledConfig(remoteUpdatedAt: number, remoteHash: string): Promise<void> {
  await patchSyncMeta({
    localConfigUpdatedAt: remoteUpdatedAt,
    lastKnownConfigHash: remoteHash,
  });
}

export function getSyncStatus(): Promise<WebdavSyncStatus> {
  return statusStorage.getValue();
}

export async function setSyncStatus(status: WebdavSyncStatus): Promise<void> {
  await statusStorage.setValue(status);
}

export function watchSyncStatus(cb: (status: WebdavSyncStatus) => void): () => void {
  return statusStorage.watch(cb);
}
