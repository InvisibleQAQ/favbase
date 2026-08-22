import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  TranscriptionCoordinator,
  DEFAULT_STATE,
} from '@/lib/bilibili/transcription-coordinator';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import type { VideoTranscribeState } from '@/lib/bilibili/transcription-coordinator';
import { startJob } from '../../hooks/background-jobs-store';
import { enqueueBiliCollectionProcessing } from './bilibili-processing-adapter';

export type { VideoTranscribeState, ContentStatus } from '@/lib/bilibili/transcription-coordinator';

// Reflect the SW-held manual transcription run into the global "don't close"
// indicator as a running-state-only job (progress stays null/indeterminate —
// per-video progress is still shown by the coordinator's section UI). The run
// promise floats to completion even after this hook unmounts (route switch), so
// the job clears when transcription actually finishes. Module-level so the
// reference is stable across renders/mounts.
const trackTranscribeRun = (_bvid: string, run: Promise<unknown>): void => {
  startJob('bilibili', 'transcribe', () => run.then(() => undefined));
};

export interface UseVideoTranscribeReturn {
  getState: (bvid: string) => VideoTranscribeState;
  startTranscribe: (video: BiliFavVideo) => void;
  cancelTranscribe: () => void;
  activeBvid: string | null;
}

export function useVideoTranscribe(
  videos: BiliFavVideo[],
): UseVideoTranscribeReturn {
  const coordRef = useRef<TranscriptionCoordinator>(null);
  if (!coordRef.current) {
    coordRef.current = new TranscriptionCoordinator(
      enqueueBiliCollectionProcessing,
      trackTranscribeRun,
    );
  }

  const snapshot = useSyncExternalStore(
    coordRef.current.subscribe,
    coordRef.current.getSnapshot,
  );

  useEffect(() => {
    coordRef.current!.setVideos(videos);
  }, [videos]);

  useEffect(() => {
    const coord = coordRef.current!;
    return () => {
      coord.dispose();
    };
  }, []);

  const getState = useCallback(
    (bvid: string): VideoTranscribeState => snapshot.stateMap.get(bvid) ?? DEFAULT_STATE,
    [snapshot.stateMap],
  );

  const startTranscribe = useCallback(
    (video: BiliFavVideo) => coordRef.current!.transcribe(video),
    [],
  );

  const cancelTranscribe = useCallback(
    () => coordRef.current!.cancel(),
    [],
  );

  return { getState, startTranscribe, cancelTranscribe, activeBvid: snapshot.activeBvid };
}
