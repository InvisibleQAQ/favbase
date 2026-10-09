import { beforeEach, describe, expect, it, vi } from 'vitest';

// Functional mocks, not defensive ones: these helpers ARE the storage reads
// the two auto-transcribe adapters share (docs/37 Step 3 ruling 10).
const storageMocks = vi.hoisted(() => ({
  resolveAsrConfig: vi.fn((settings: any) => ({
    apiKey: settings.asrConfigs?.[settings.asrProvider]?.apiKey ?? '',
    model: '',
    baseUrl: '',
  })),
  settingsStorage: { getValue: vi.fn(), watch: vi.fn() },
  asrQuotaPauseStorage: { getValue: vi.fn(), setValue: vi.fn() },
}));

vi.mock('./settings', () => ({
  resolveAsrConfig: storageMocks.resolveAsrConfig,
  settingsStorage: storageMocks.settingsStorage,
  getAsrSettings: async () => storageMocks.resolveAsrConfig(await storageMocks.settingsStorage.getValue()),
}));
vi.mock('./ui-state', () => ({ asrQuotaPauseStorage: storageMocks.asrQuotaPauseStorage }));

import {
  getActiveAsrQuotaPause,
  hasAsrApiKey,
  setAsrQuotaPause,
  waitForAsrApiKey,
} from './asr-prerequisite';

describe('ASR prerequisite storage helpers (shared by the auto-transcribe adapters)', () => {
  beforeEach(() => {
    storageMocks.settingsStorage.getValue.mockReset();
    storageMocks.settingsStorage.watch.mockReset();
    storageMocks.asrQuotaPauseStorage.getValue.mockReset();
    storageMocks.asrQuotaPauseStorage.setValue.mockReset();
  });

  it('reports whether the active provider has a key right now', async () => {
    storageMocks.settingsStorage.getValue.mockResolvedValue({
      asrProvider: 'groq',
      asrConfigs: { groq: { apiKey: 'configured' } },
    });
    await expect(hasAsrApiKey()).resolves.toBe(true);

    storageMocks.settingsStorage.getValue.mockResolvedValue({ asrProvider: 'groq', asrConfigs: {} });
    await expect(hasAsrApiKey()).resolves.toBe(false);
  });

  it('loads a quota pause only for the active ASR provider, and writes one back', async () => {
    storageMocks.asrQuotaPauseStorage.getValue.mockResolvedValue({
      providerId: 'groq',
      resetAt: 5_000,
    });
    storageMocks.settingsStorage.getValue.mockResolvedValue({ asrProvider: 'groq' });

    await expect(getActiveAsrQuotaPause()).resolves.toEqual({ providerId: 'groq', resetAt: 5_000 });

    storageMocks.settingsStorage.getValue.mockResolvedValue({ asrProvider: 'siliconflow' });
    await expect(getActiveAsrQuotaPause()).resolves.toBeNull();

    await setAsrQuotaPause(null);
    expect(storageMocks.asrQuotaPauseStorage.setValue).toHaveBeenCalledWith(null);
  });

  it('waits for a valid ASR setting without losing an update racing the initial read', async () => {
    let resolveInitial!: (settings: any) => void;
    const initial = new Promise<any>((resolve) => {
      resolveInitial = resolve;
    });
    let onChange!: (settings: any) => void;
    const unwatch = vi.fn();
    storageMocks.settingsStorage.getValue.mockReturnValue(initial);
    storageMocks.settingsStorage.watch.mockImplementation((callback) => {
      onChange = callback;
      return unwatch;
    });

    const waiting = waitForAsrApiKey();
    onChange({
      asrProvider: 'groq',
      asrConfigs: { groq: { apiKey: 'configured', model: 'whisper' } },
    });
    await waiting;
    resolveInitial({ asrProvider: 'groq', asrConfigs: {} });

    expect(unwatch).toHaveBeenCalledOnce();
  });
});
