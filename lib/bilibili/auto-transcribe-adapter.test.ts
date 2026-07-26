import { describe, expect, it, vi } from 'vitest';

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getAsrSettings: vi.fn(async () => ({ apiKey: '' })),
  settingsStorage: { getValue: vi.fn() },
  asrQuotaPauseStorage: { getValue: vi.fn(), setValue: vi.fn() },
}));

vi.mock('./transcribe-utils', () => transcribeMocks);

vi.mock('./bili-sync-service', () => ({
  checkAuth: vi.fn(),
  fetchAndSyncVideos: vi.fn(),
  getPendingBvids: vi.fn(),
  getPendingPreview: vi.fn(),
  markVideoError: vi.fn(),
}));

vi.mock('@/lib/storage', () => storageMocks);

import { createBiliAutoTranscribeAdapter } from './auto-transcribe-adapter';

describe('Bilibili auto-transcribe adapter processing seam', () => {
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
});
