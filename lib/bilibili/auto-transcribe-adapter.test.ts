import { beforeEach, describe, expect, it, vi } from 'vitest';

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getAsrSettings: vi.fn(async () => ({ apiKey: '' })),
  resolveAsrConfig: vi.fn((settings: any) => ({
    apiKey: settings.asrConfigs?.[settings.asrProvider]?.apiKey ?? '',
    model: '',
    baseUrl: '',
  })),
  settingsStorage: { getValue: vi.fn(), watch: vi.fn() },
  asrQuotaPauseStorage: { getValue: vi.fn(), setValue: vi.fn() },
}));

vi.mock('./transcribe-utils', () => transcribeMocks);

vi.mock('./bili-sync-service', () => ({
  markVideoError: vi.fn(),
}));

vi.mock('@/lib/storage', () => storageMocks);

import { createBiliAutoTranscribeAdapter } from './auto-transcribe-adapter';

describe('Bilibili auto-transcribe adapter processing seam', () => {
  beforeEach(() => {
    storageMocks.settingsStorage.getValue.mockReset();
    storageMocks.settingsStorage.watch.mockReset();
  });

  it('forwards the injected processing starter', async () => {
    const startProcessing = vi.fn();
    const adapter = createBiliAutoTranscribeAdapter({ startProcessing });

    await adapter.transcribe('BV1', 'Video');

    expect(transcribeMocks.transcribeAndPersist).toHaveBeenCalledWith(
      'BV1',
      'Video',
      expect.objectContaining({ startProcessing }),
    );
  });

  it('loads a quota pause only for the active ASR provider', async () => {
    storageMocks.asrQuotaPauseStorage.getValue.mockResolvedValue({
      providerId: 'groq',
      resetAt: 5_000,
    });
    storageMocks.settingsStorage.getValue.mockResolvedValue({ asrProvider: 'groq' });
    const adapter = createBiliAutoTranscribeAdapter();

    await expect(adapter.getQuotaPause()).resolves.toEqual({
      providerId: 'groq',
      resetAt: 5_000,
    });

    storageMocks.settingsStorage.getValue.mockResolvedValue({ asrProvider: 'siliconflow' });
    await expect(adapter.getQuotaPause()).resolves.toBeNull();
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
    const adapter = createBiliAutoTranscribeAdapter();

    const waiting = adapter.waitForAsrKey();
    onChange({
      asrProvider: 'groq',
      asrConfigs: { groq: { apiKey: 'configured', model: 'whisper' } },
    });
    await waiting;
    resolveInitial({ asrProvider: 'groq', asrConfigs: {} });

    expect(unwatch).toHaveBeenCalledOnce();
  });
});
