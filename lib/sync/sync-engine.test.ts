import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_PATH, SYS_PATH } from './constants';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings-schema';

const mocks = vi.hoisted(() => ({
  client: {
    ensureDirectory: vi.fn(),
    getJSON: vi.fn(),
    putJSON: vi.fn(),
    deletePath: vi.fn(),
  },
  settingsStorage: {
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  localeStorage: {
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  getSyncMeta: vi.fn(),
  patchSyncMeta: vi.fn(),
  adoptPulledConfig: vi.fn(),
  seedConfigClockIfUnset: vi.fn(),
  setSyncStatus: vi.fn(),
  expectPulledHashes: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  settingsStorage: mocks.settingsStorage,
  localeStorage: mocks.localeStorage,
}));

vi.mock('./webdav-client', () => ({
  WebdavClient: vi.fn(function WebdavClient() {
    return mocks.client;
  }),
}));

vi.mock('./sync-config-storage', () => ({
  getWebdavConfig: vi.fn(async () => ({
    enabled: true,
    url: 'https://dav.example.test',
    username: 'user',
    password: 'password',
  })),
  isConfigSyncable: vi.fn(() => true),
}));

vi.mock('./sync-meta-storage', () => ({
  getSyncMeta: mocks.getSyncMeta,
  patchSyncMeta: mocks.patchSyncMeta,
  adoptPulledConfig: mocks.adoptPulledConfig,
  seedConfigClockIfUnset: mocks.seedConfigClockIfUnset,
  setSyncStatus: mocks.setSyncStatus,
  expectPulledHashes: mocks.expectPulledHashes,
}));

import { doSync } from './sync-engine';

describe('doSync settings pull', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks.client)) mock.mockReset();
    for (const mock of Object.values(mocks.settingsStorage)) mock.mockReset();
    for (const mock of Object.values(mocks.localeStorage)) mock.mockReset();
    mocks.getSyncMeta.mockReset();
    mocks.patchSyncMeta.mockReset();
    mocks.adoptPulledConfig.mockReset();
    mocks.seedConfigClockIfUnset.mockReset();
    mocks.setSyncStatus.mockReset();
    mocks.expectPulledHashes.mockReset();

    mocks.client.ensureDirectory.mockResolvedValue(undefined);
    mocks.client.putJSON.mockResolvedValue(undefined);
    mocks.getSyncMeta.mockResolvedValue({
      localConfigUpdatedAt: 1,
      lastKnownConfigHash: 'local-hash',
      syncVersion: 'local-version',
      lastSyncTime: 0,
    });
    mocks.seedConfigClockIfUnset.mockResolvedValue(undefined);
    mocks.setSyncStatus.mockResolvedValue(undefined);
    mocks.patchSyncMeta.mockResolvedValue(undefined);
  });

  it('rejects invalid remote settings before changing local settings or pull metadata', async () => {
    mocks.client.getJSON.mockImplementation(async (path: string) => {
      if (path === SYS_PATH) return null;
      if (path === CONFIG_PATH) {
        return {
          version: 1,
          updatedAt: 2,
          settings: { provider: 'invalid-provider' },
          locale: 'en',
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await doSync();

    expect(result).toMatchObject({ ok: false, errorCode: 'invalid-settings' });
    expect(mocks.settingsStorage.setValue).not.toHaveBeenCalled();
    expect(mocks.adoptPulledConfig).not.toHaveBeenCalled();
    expect(mocks.expectPulledHashes).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('canonicalizes a compatible remote config before hashing and storing it', async () => {
    mocks.client.getJSON.mockImplementation(async (path: string) => {
      if (path === SYS_PATH) return null;
      if (path === CONFIG_PATH) {
        return {
          version: 1,
          updatedAt: 2,
          settings: { provider: 'openai' },
          locale: 'en',
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    mocks.localeStorage.getValue.mockResolvedValue('zh-CN');
    mocks.settingsStorage.setValue.mockResolvedValue(undefined);
    mocks.localeStorage.setValue.mockResolvedValue(undefined);
    mocks.adoptPulledConfig.mockResolvedValue(undefined);

    await expect(doSync()).resolves.toEqual({ ok: true });
    expect(mocks.settingsStorage.setValue).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
    });
    expect(mocks.expectPulledHashes).toHaveBeenCalledTimes(1);
    expect(mocks.adoptPulledConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settingsStorage.setValue.mock.invocationCallOrder[0],
    );
  });

  it('rejects an incompatible remote version without changing pull state', async () => {
    mocks.client.getJSON.mockImplementation(async (path: string) => {
      if (path === SYS_PATH) return null;
      if (path === CONFIG_PATH) {
        return { version: 2, updatedAt: 2, settings: {}, locale: 'en' };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await doSync();

    expect(result).toMatchObject({ ok: false, errorCode: 'incompatible-version' });
    expect(mocks.settingsStorage.setValue).not.toHaveBeenCalled();
    expect(mocks.adoptPulledConfig).not.toHaveBeenCalled();
    expect(mocks.expectPulledHashes).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
