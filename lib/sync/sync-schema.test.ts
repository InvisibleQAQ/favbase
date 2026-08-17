import { describe, it, expect } from 'vitest';
import {
  parseRemoteConfig,
  parseRemoteSys,
  RemoteConfigVersionError,
} from './sync-schema';
import { encryptSecret, decryptSecret } from './crypto';
import {
  DEFAULT_SETTINGS,
  SettingsValidationError,
} from '@/lib/storage/settings-schema';

describe('parseRemoteConfig', () => {
  it('accepts a well-formed config', () => {
    const raw = { version: 1, updatedAt: 5, settings: { provider: 'openai' }, locale: 'zh-CN' };
    expect(parseRemoteConfig(raw)).toEqual({
      ...raw,
      settings: { ...DEFAULT_SETTINGS, provider: 'openai' },
    });
  });

  it('rejects garbage / conflict copies as null', () => {
    expect(parseRemoteConfig(null)).toBeNull();
    expect(parseRemoteConfig('not json object')).toBeNull();
    expect(parseRemoteConfig({ version: 1 })).toBeNull(); // missing fields
    expect(parseRemoteConfig({ version: 1, updatedAt: 5, settings: {}, locale: 'de' })).toBeNull();
  });

  it('surfaces malformed settings separately from a missing remote config', () => {
    const envelope = { version: 1, updatedAt: 5, locale: 'en' };

    expect(() => parseRemoteConfig({ ...envelope, settings: { provider: 'invalid' } }))
      .toThrow(SettingsValidationError);
    expect(() => parseRemoteConfig({ ...envelope, settings: 42 }))
      .toThrow(SettingsValidationError);
    expect(() => parseRemoteConfig({ ...envelope, settings: null }))
      .toThrow(SettingsValidationError);
  });

  it('rejects remote config versions this client does not understand', () => {
    expect(() =>
      parseRemoteConfig({
        version: 2,
        updatedAt: 5,
        settings: {},
        locale: 'en',
      }),
    ).toThrow(RemoteConfigVersionError);
  });
});

describe('parseRemoteSys', () => {
  it('accepts a well-formed sys record', () => {
    const raw = { lock_status: 'locked', lock_timestamp: 1, sync_version: 'v', last_sync_time: 2 };
    expect(parseRemoteSys(raw)).toEqual(raw);
  });

  it('rejects invalid lock_status', () => {
    expect(
      parseRemoteSys({ lock_status: 'weird', lock_timestamp: 1, sync_version: 'v', last_sync_time: 2 }),
    ).toBeNull();
  });
});

describe('crypto obfuscation', () => {
  it('round-trips a secret', async () => {
    const secret = 'hunter2-应用授权码';
    const enc = await encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(await decryptSecret(enc)).toBe(secret);
  });

  it('maps empty to empty both ways', async () => {
    expect(await encryptSecret('')).toBe('');
    expect(await decryptSecret('')).toBe('');
  });

  it('falls back to input on undecryptable data (legacy plaintext)', async () => {
    expect(await decryptSecret('not-a-valid-blob')).toBe('not-a-valid-blob');
  });
});
