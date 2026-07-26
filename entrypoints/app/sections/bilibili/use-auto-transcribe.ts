import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type {
  AutoTranscribePhase,
  AutoTranscribeStats,
  AutoTranscribeCurrentVideo,
  AutoTranscribeState,
} from '@/lib/auto-transcribe/types';

import { biliAutoTranscribePipeline, startBiliAutoTranscribe } from './auto-transcribe-runtime';

export type { AutoTranscribePhase, AutoTranscribeStats, AutoTranscribeCurrentVideo, AutoTranscribeState };

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
  start: () => void;
}

/**
 * Thin view subscription over the module-level pipeline singleton
 * (auto-transcribe-runtime.ts). Unmounting does NOT dispose/abort — the batch
 * run belongs to the `bilibili:transcribe` background job and survives route
 * switches. `start` is the auto-continuation target (post-fetch chaining);
 * there is no stop control — pause/resume belongs to the library gate.
 */
export function useAutoTranscribe(collectionId: number | undefined): UseAutoTranscribeReturn {
  const state = useSyncExternalStore(
    biliAutoTranscribePipeline.subscribe,
    biliAutoTranscribePipeline.getSnapshot,
  );

  useEffect(() => {
    if (!collectionId) return;
    void biliAutoTranscribePipeline.queryPreview(String(collectionId));
  }, [collectionId, state.phase]);

  const start = useCallback(() => {
    if (!collectionId) return;
    startBiliAutoTranscribe(String(collectionId));
  }, [collectionId]);

  return {
    state,
    running:
      state.phase === 'syncing'
      || state.phase === 'transcribing'
      || state.phase === 'waiting'
      || state.phase === 'paused',
    start,
  };
}
