import { useSyncExternalStore } from 'react';
import type { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import type {
  AutoTranscribePhase,
  AutoTranscribeStats,
  AutoTranscribeCurrentVideo,
  AutoTranscribeState,
} from '@/lib/auto-transcribe/types';

export type { AutoTranscribePhase, AutoTranscribeStats, AutoTranscribeCurrentVideo, AutoTranscribeState };

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
}

/**
 * Thin view subscription over a platform's module-level pipeline singleton
 * (each `sections/<platform>/auto-transcribe-runtime.ts` owns one). Unmounting
 * does NOT dispose / abort — the batch run belongs to the platform's
 * `transcribe` background job and survives route switches. Fetch owns producer
 * creation through the platform runtime; this hook has no start / stop side
 * effects.
 */
export function useAutoTranscribe(pipeline: AutoTranscribePipeline): UseAutoTranscribeReturn {
  const state = useSyncExternalStore(pipeline.subscribe, pipeline.getSnapshot);

  return {
    state,
    running:
      state.phase === 'transcribing'
      || state.phase === 'waiting'
      || state.phase === 'paused'
      || state.phase === 'configuration_required',
  };
}
