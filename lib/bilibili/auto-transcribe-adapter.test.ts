import { beforeEach, describe, expect, it, vi } from 'vitest';

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn(),
}));

// Functional mocks: the ASR prerequisite helpers are the storage reads this
// adapter delegates to (lib/storage/asr-prerequisite.ts has their own tests).
const storageMocks = vi.hoisted(() => ({
  hasAsrApiKey: vi.fn(async () => false),
  waitForAsrApiKey: vi.fn(async () => undefined),
  getActiveAsrQuotaPause: vi.fn(async () => null),
  setAsrQuotaPause: vi.fn(async () => undefined),
}));

vi.mock('./transcribe-utils', () => transcribeMocks);

vi.mock('./bili-sync-service', () => ({
  markVideoError: vi.fn(),
}));

vi.mock('@/lib/storage', () => storageMocks);

import { createBiliAutoTranscribeAdapter } from './auto-transcribe-adapter';

describe('Bilibili auto-transcribe adapter processing seam', () => {
  beforeEach(() => {
    storageMocks.hasAsrApiKey.mockReset().mockResolvedValue(false);
    storageMocks.waitForAsrApiKey.mockReset().mockResolvedValue(undefined);
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

  it("judges only a missing ASR key as a prerequisite, and only while the key is still missing", async () => {
    const adapter = createBiliAutoTranscribeAdapter({ startProcessing: vi.fn() });
    const invalidKey = { code: 'ASR_INVALID_KEY' as const, message: 'no key' };

    await expect(adapter.missingPrerequisite(invalidKey)).resolves.toBe('asr');

    storageMocks.hasAsrApiKey.mockResolvedValue(true);
    await expect(adapter.missingPrerequisite(invalidKey)).resolves.toBeNull();
    await expect(
      adapter.missingPrerequisite({ code: 'ASR_UNKNOWN', message: 'boom' }),
    ).resolves.toBeNull();
  });

  it('waits on the shared ASR key watcher and delegates the quota pause to the shared helpers', async () => {
    const adapter = createBiliAutoTranscribeAdapter({ startProcessing: vi.fn() });

    await adapter.waitForPrerequisite({ code: 'ASR_INVALID_KEY', message: 'no key' });
    expect(storageMocks.waitForAsrApiKey).toHaveBeenCalledOnce();

    expect(adapter.getQuotaPause).toBe(storageMocks.getActiveAsrQuotaPause);
    expect(adapter.setQuotaPause).toBe(storageMocks.setAsrQuotaPause);
  });
});
