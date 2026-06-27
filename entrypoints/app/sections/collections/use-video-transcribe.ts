import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  TranscriptionCoordinator,
  DEFAULT_STATE,
} from '@/lib/bilibili/transcription-coordinator';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import type { VideoTranscribeState } from '@/lib/bilibili/transcription-coordinator';

export type { VideoTranscribeState, ContentStatus } from '@/lib/bilibili/transcription-coordinator';

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
    coordRef.current = new TranscriptionCoordinator();
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
