import { z } from 'zod';
import { canonicalizeSettings } from '@/lib/storage/settings-schema';
import type { RemoteConfig, RemoteSys } from './types';
import { CONFIG_VERSION } from './constants';

/**
 * WebDAV envelope guards run before sync decisions. Invalid envelopes are
 * treated as missing remote data; an incompatible version or invalid Settings
 * payload throws a typed error so the engine stops instead of pushing over it.
 * Settings shape, defaults, migration, and forward-compatible passthrough stay
 * owned by the storage Module's canonicalizer.
 */

const LocaleSchema = z.enum(['auto', 'zh-CN', 'en']);
const RequiredSettingsInputSchema = z
  .unknown()
  .refine((value) => value !== undefined, { message: 'settings is required' });

export const RemoteConfigSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  settings: RequiredSettingsInputSchema,
  locale: LocaleSchema,
});

export class RemoteConfigVersionError extends Error {
  constructor(readonly version: number) {
    super(`Unsupported remote config version: ${version}`);
    this.name = 'RemoteConfigVersionError';
  }
}

export const RemoteSysSchema = z.object({
  lock_status: z.enum(['locked', 'unlocked']),
  lock_timestamp: z.number(),
  sync_version: z.string(),
  last_sync_time: z.number(),
});

/** Parse and canonicalize config.json; invalid Settings/version errors throw. */
export function parseRemoteConfig(raw: unknown): RemoteConfig | null {
  const r = RemoteConfigSchema.safeParse(raw);
  if (!r.success) return null;
  if (r.data.version !== CONFIG_VERSION) {
    throw new RemoteConfigVersionError(r.data.version);
  }
  return { ...r.data, settings: canonicalizeSettings(r.data.settings) };
}

/** Parse remote sys.json; returns null on any validation failure. */
export function parseRemoteSys(raw: unknown): RemoteSys | null {
  const r = RemoteSysSchema.safeParse(raw);
  return r.success ? (r.data as RemoteSys) : null;
}
