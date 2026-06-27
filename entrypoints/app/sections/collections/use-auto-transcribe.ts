import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  AutoTranscribePipeline,
  type AutoTranscribePhase,
  type AutoTranscribeStats,
  type AutoTranscribeCurrentVideo,
  type AutoTranscribeState,
} from '@/lib/bilibili/auto-transcribe-pipeline';

export type { AutoTranscribePhase, AutoTranscribeStats, AutoTranscribeCurrentVideo, AutoTranscribeState };

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
  start: () => void;
  stop: () => void;
}

export function useAutoTranscribe(mediaId: number | undefined): UseAutoTranscribeReturn {
  const pipelineRef = useRef<AutoTranscribePipeline>(null);
  if (!pipelineRef.current) {
    pipelineRef.current = new AutoTranscribePipeline();
  }

  const state = useSyncExternalStore(
    pipelineRef.current.subscribe,
    pipelineRef.current.getSnapshot,
  );

  useEffect(() => {
    if (!mediaId) return;
    pipelineRef.current!.queryPreview(mediaId);
  }, [mediaId, state.phase]);

  const start = useCallback(() => {
    if (!mediaId) return;
    pipelineRef.current!.start(mediaId);
  }, [mediaId]);

  const stop = useCallback(() => {
    pipelineRef.current!.stop();
  }, []);

  useEffect(() => {
    const p = pipelineRef.current!;
    return () => { p.dispose(); };
  }, []);

  return {
    state,
    running: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'cancelled',
    start,
    stop,
  };
}
