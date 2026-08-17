import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  rawSettings: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    watch: vi.fn<
      (callback: (newValue: unknown, oldValue: unknown) => void) => () => void
    >(() => () => {}),
  },
}));

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: vi.fn(() => storageMocks.rawSettings),
  },
}));

import {
  DEFAULT_SETTINGS,
  migrateSettingsIfNeeded,
  settingsStorage,
  SettingsValidationError,
  type UserSettings,
} from './settings';

describe('settingsStorage', () => {
  beforeEach(() => {
    storageMocks.rawSettings.getValue.mockReset();
    storageMocks.rawSettings.setValue.mockReset();
    storageMocks.rawSettings.watch.mockReset();
    storageMocks.rawSettings.watch.mockReturnValue(() => {});
  });

  it('returns canonical settings for an incomplete persisted value', async () => {
    storageMocks.rawSettings.getValue.mockResolvedValue({ provider: 'openai' });

    await expect(settingsStorage.getValue()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
    });
  });

  it('rejects invalid writes before they reach raw storage', async () => {
    const invalid = { ...DEFAULT_SETTINGS, provider: 'invalid' } as unknown as UserSettings;

    await expect(settingsStorage.setValue(invalid)).rejects.toBeInstanceOf(
      SettingsValidationError,
    );
    expect(storageMocks.rawSettings.setValue).not.toHaveBeenCalled();
  });

  it('publishes only canonical watched values', () => {
    const listener = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    settingsStorage.watch(listener);
    const rawListener = storageMocks.rawSettings.watch.mock.calls[0]?.[0] as (
      newValue: unknown,
      oldValue: unknown,
    ) => void;

    rawListener({ provider: 'openai' }, null);
    rawListener({ provider: 'invalid' }, { provider: 'openai' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      { ...DEFAULT_SETTINGS, provider: 'openai' },
      null,
    );
    consoleError.mockRestore();
  });

  it('falls back to fresh defaults when persisted settings are malformed', async () => {
    storageMocks.rawSettings.getValue.mockResolvedValue({ provider: 'invalid' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(settingsStorage.getValue()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(consoleError).toHaveBeenCalledWith(
      '[favbase settings] invalid persisted settings',
      expect.stringContaining('provider'),
    );
    consoleError.mockRestore();
  });

  it('persists legacy ASR data through the shared canonicalizer', async () => {
    storageMocks.rawSettings.getValue.mockResolvedValue({
      provider: 'openai',
      groqApiKey: 'legacy-key',
      groqModel: 'legacy-model',
    });

    await migrateSettingsIfNeeded();

    expect(storageMocks.rawSettings.setValue).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      asrConfigs: {
        groq: { apiKey: 'legacy-key', model: 'legacy-model' },
      },
    });
  });
});
