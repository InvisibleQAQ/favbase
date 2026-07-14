import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  AutoTranscribePipeline,
} from '@/lib/auto-transcribe/pipeline';
import type {
  AutoTranscribeAdapter,
  AutoTranscribePhase,
  AutoTranscribeStats,
  AutoTranscribeCurrentVideo,
  AutoTranscribeState,
} from '@/lib/auto-transcribe/types';

export type { AutoTranscribePhase, AutoTranscribeStats, AutoTranscribeCurrentVideo, AutoTranscribeState };

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
  start: () => void;
  stop: () => void;
}

export function useAutoTranscribe(
  collectionId: number | undefined,
  adapter: AutoTranscribeAdapter,
): UseAutoTranscribeReturn {
  const pipelineRef = useRef<AutoTranscribePipeline>(null);
  if (!pipelineRef.current) {
    pipelineRef.current = new AutoTranscribePipeline(adapter);
  }

  const state = useSyncExternalStore(
    pipelineRef.current.subscribe,
    pipelineRef.current.getSnapshot,
  );

  useEffect(() => {
    if (!collectionId) return;
    pipelineRef.current!.queryPreview(String(collectionId));
  }, [collectionId, state.phase]);

  const start = useCallback(() => {
    if (!collectionId) return;
    pipelineRef.current!.start(String(collectionId));
  }, [collectionId]);

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
