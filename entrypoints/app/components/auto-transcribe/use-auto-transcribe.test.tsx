// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import type { AutoTranscribePhase, AutoTranscribeState } from '@/lib/auto-transcribe/types';

import { useAutoTranscribe } from './use-auto-transcribe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function state(phase: AutoTranscribePhase): AutoTranscribeState {
  return {
    phase,
    prerequisiteBlocked: null,
    currentVideoTitle: '',
    currentVideoId: '',
    currentVideo: null,
    totalVideos: 0,
    currentIndex: 0,
    videoProgress: 0,
    videoStage: '',
    waitSeconds: 0,
    quotaResetAt: null,
    stats: { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 },
  };
}

/** A pipeline double with the useSyncExternalStore contract and nothing else. */
function fakePipeline(initial: AutoTranscribeState) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const pipeline = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  } as unknown as AutoTranscribePipeline;
  return {
    pipeline,
    set(next: AutoTranscribeState) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('useAutoTranscribe (a pure subscription over the pipeline it is handed)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen: { phase: AutoTranscribePhase; running: boolean }[] = [];

  function Probe({ pipeline }: { pipeline: AutoTranscribePipeline }) {
    const { state: current, running } = useAutoTranscribe(pipeline);
    seen.push({ phase: current.phase, running });
    return null;
  }

  beforeEach(() => {
    seen.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reports running for the four active phases only, and re-renders when the snapshot changes', () => {
    const store = fakePipeline(state('idle'));
    act(() => {
      root.render(<Probe pipeline={store.pipeline} />);
    });
    expect(seen.at(-1)).toEqual({ phase: 'idle', running: false });

    for (const phase of ['transcribing', 'waiting', 'paused', 'configuration_required'] as const) {
      act(() => store.set(state(phase)));
      expect(seen.at(-1), phase).toEqual({ phase, running: true });
    }
    for (const phase of ['quota_paused', 'done', 'cancelled'] as const) {
      act(() => store.set(state(phase)));
      expect(seen.at(-1), phase).toEqual({ phase, running: false });
    }
  });
});
