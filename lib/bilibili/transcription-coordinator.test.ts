import { describe, expect, it, vi } from 'vitest';

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn(() => () => undefined),
}));

vi.mock('./transcribe-utils', () => transcribeMocks);

vi.mock('./bili-sync-service', () => ({
  getEmbeddedBvids: vi.fn(async () => []),
}));

vi.mock('@/lib/cache/video-cache', () => ({
  onVideoCacheChange: vi.fn(() => () => undefined),
}));

import type { BiliFavVideo } from './types';
import { TranscriptionCoordinator } from './transcription-coordinator';

describe('TranscriptionCoordinator processing seam', () => {
  it('forwards the injected processing starter to transcription persistence', () => {
    const startProcessing = vi.fn();
    const coordinator = new TranscriptionCoordinator(undefined, startProcessing);

    coordinator.transcribe({ bvid: 'BV1', title: 'Video', attr: 0 } as BiliFavVideo);

    expect(transcribeMocks.transcribeAndPersist).toHaveBeenCalledWith(
      'BV1',
      'Video',
      expect.objectContaining({ startProcessing }),
    );
  });
});
