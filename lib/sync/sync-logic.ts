import type { UserSettings, LocalePreference } from '@/lib/storage';
import type { RemoteConfig, RemoteSys } from './types';
import { LOCK_TIMEOUT_MS } from './constants';

/**
 * Pure sync decisions — no storage, no network, no clock. Everything here is
 * unit-testable in isolation (see sync-logic.test.ts); the engine wires these
 * to the impure edges. Mirrors the pure-function split in use-config-draft.ts.
 */

/** Recursively key-sorted JSON — stable across key insertion order. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

/** FNV-1a 32-bit hex of a string. Collision risk is negligible for config. */
export function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Content fingerprint of the synced config (settings + locale). */
export function hashConfig(settings: UserSettings, locale: LocalePreference): string {
  return hashString(canonicalStringify({ settings, locale }));
}

/**
 * Whole-config Last-Write-Wins decision.
 * - No remote yet → seed it from local (`push`).
 * - Remote newer → `pull`; local newer → `push`; equal → `noop`.
 * Ties resolve to noop (identical timestamps = no work).
 */
export function decideConfigSync(
  localUpdatedAt: number,
  remote: RemoteConfig | null,
): 'push' | 'pull' | 'noop' {
  if (!remote) return 'push';
  if (remote.updatedAt > localUpdatedAt) return 'pull';
  if (localUpdatedAt > remote.updatedAt) return 'push';
  return 'noop';
}

/**
 * May this device acquire the cross-device lock right now?
 * Free when: no sys.json yet, unlocked, or the existing lock is stale (older
 * than LOCK_TIMEOUT_MS — the holder likely crashed mid-sync).
 */
export function canAcquireLock(sys: RemoteSys | null, now: number): boolean {
  if (!sys) return true;
  if (sys.lock_status !== 'locked') return true;
  return now - sys.lock_timestamp >= LOCK_TIMEOUT_MS;
}
