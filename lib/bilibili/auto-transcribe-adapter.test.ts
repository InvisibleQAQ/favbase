import { describe, expect, it, vi } from 'vitest';

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn(),
}));

vi.mock('./transcribe-utils', () => transcribeMocks);

vi.mock('./bili-sync-service', () => ({
  checkAuth: vi.fn(),
  fetchAndSyncVideos: vi.fn(),
  getPendingBvids: vi.fn(),
  getPendingPreview: vi.fn(),
  markVideoError: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getAsrSettings: vi.fn(async () => ({ apiKey: '' })),
}));

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
});
