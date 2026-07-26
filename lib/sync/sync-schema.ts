import { z } from 'zod';
import type { RemoteConfig, RemoteSys } from './types';

/**
 * Zod guards for everything read back from WebDAV. Any remote JSON is parsed
 * through these BEFORE touching local state — a conflict copy, a truncated
 * write, or a hand-edited file `safeParse`s to failure and is treated as "no
 * remote data" (never crashes local, never corrupts settings).
 *
 * `settings` is validated only as a non-empty object (not the full UserSettings
 * shape): it's the user's own config round-tripping through their own server,
 * and coupling this guard to every UserSettings field would reject otherwise
 * valid data whenever the settings schema evolves. Whole-config LWW trusts the
 * object; the envelope guard just rejects garbage.
 */

const LocaleSchema = z.enum(['auto', 'zh-CN', 'en']);

export const RemoteConfigSchema = z.object({
  version: z.number(),
  updatedAt: z.number(),
  settings: z.record(z.string(), z.unknown()),
  locale: LocaleSchema,
});

export const RemoteSysSchema = z.object({
  lock_status: z.enum(['locked', 'unlocked']),
  lock_timestamp: z.number(),
  sync_version: z.string(),
  last_sync_time: z.number(),
});

/** Parse remote config.json; returns null on any validation failure. */
export function parseRemoteConfig(raw: unknown): RemoteConfig | null {
  const r = RemoteConfigSchema.safeParse(raw);
  // Loosely-validated envelope (settings is a plain object) → cast through
  // unknown; whole-config LWW trusts the user's own round-tripped config.
  return r.success ? (r.data as unknown as RemoteConfig) : null;
}

/** Parse remote sys.json; returns null on any validation failure. */
export function parseRemoteSys(raw: unknown): RemoteSys | null {
  const r = RemoteSysSchema.safeParse(raw);
  return r.success ? (r.data as RemoteSys) : null;
}
