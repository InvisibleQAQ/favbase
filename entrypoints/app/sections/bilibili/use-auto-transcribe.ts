import { useSyncExternalStore } from 'react';
import type {
  AutoTranscribePhase,
  AutoTranscribeStats,
  AutoTranscribeCurrentVideo,
  AutoTranscribeState,
} from '@/lib/auto-transcribe/types';

import { biliAutoTranscribePipeline } from './auto-transcribe-runtime';

export type { AutoTranscribePhase, AutoTranscribeStats, AutoTranscribeCurrentVideo, AutoTranscribeState };

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
}

/**
 * Thin view subscription over the module-level pipeline singleton
 * (auto-transcribe-runtime.ts). Unmounting does NOT dispose/abort — the batch
 * run belongs to the `bilibili:transcribe` background job and survives route
 * switches. Fetch owns producer creation through auto-transcribe-runtime;
 * this hook has no start/stop side effects.
 */
export function useAutoTranscribe(): UseAutoTranscribeReturn {
  const state = useSyncExternalStore(
    biliAutoTranscribePipeline.subscribe,
    biliAutoTranscribePipeline.getSnapshot,
  );

  return {
    state,
    running:
      state.phase === 'transcribing'
      || state.phase === 'waiting'
      || state.phase === 'paused'
      || state.phase === 'configuration_required',
  };
}
