import { describe, expect, it, vi } from 'vitest';

type TranscribeAndPersist = typeof import('./transcribe-utils').transcribeAndPersist;
type CreateStatusListener = typeof import('./transcribe-utils').createStatusListener;

const transcribeMocks = vi.hoisted(() => ({
  transcribeAndPersist: vi.fn<TranscribeAndPersist>(async () => ({
    success: false as const,
    error: { code: 'ASR_UNKNOWN' as const, message: 'test' },
  })),
  createStatusListener: vi.fn<CreateStatusListener>(() => () => undefined),
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

  it('updates indexed state when Embedding settles after transcription returns', async () => {
    let onIndexed: ((result: 'embedded' | 'chunked' | null) => void) | undefined;
    transcribeMocks.transcribeAndPersist.mockImplementationOnce(async (_bvid, _title, hooks) => {
      onIndexed = hooks?.onIndexed;
      return {
        success: true as const,
        data: { rows: [], source: 'asr' as const, cached: false },
      };
    });
    const coordinator = new TranscriptionCoordinator();

    coordinator.transcribe({ bvid: 'BV-LATE-EMBED', title: 'Video', attr: 0 } as BiliFavVideo);
    await vi.waitFor(() =>
      expect(coordinator.getVideoState('BV-LATE-EMBED').transcribing).toBe(false),
    );
    expect(coordinator.getVideoState('BV-LATE-EMBED').indexed).toBe(false);

    onIndexed?.('embedded');

    expect(coordinator.getVideoState('BV-LATE-EMBED').indexed).toBe(true);
  });
});
