import type { CooperativeCheckpoint } from '@/lib/collections';

export type PipelineRunPhase = 'running' | 'pausing' | 'paused';

export interface PipelineRunControl extends CooperativeCheckpoint {
  getPhase: () => PipelineRunPhase;
  pause: () => void;
  resume: () => void;
  checkpoint: () => Promise<void>;
}

/**
 * Cooperative pause state machine for ONE run.
 *
 * `initialPhase` exists for the library gate: a run dispatched while its
 * platform is paused is born `'paused'` and blocks on its FIRST checkpoint.
 * Born-paused (rather than refusing to start) is what keeps the queued work —
 * batch ids / streaming inbox — alive in the runner closure, and it is why the
 * checkpoint guard below tests `=== 'running'` instead of `!== 'pausing'`.
 */
export function createPipelineRunControl(
  onPhaseChange: (phase: PipelineRunPhase) => void,
  initialPhase: PipelineRunPhase = 'running',
): PipelineRunControl {
  let phase: PipelineRunPhase = initialPhase;
  let continueRun: (() => void) | null = null;

  const setPhase = (nextPhase: PipelineRunPhase) => {
    phase = nextPhase;
    onPhaseChange(nextPhase);
  };

  return {
    getPhase: () => phase,
    pause: () => {
      if (phase !== 'running') return;
      setPhase('pausing');
    },
    resume: () => {
      if (phase === 'running') return;
      setPhase('running');
      continueRun?.();
      continueRun = null;
    },
    checkpoint: async () => {
      // 'running' is the ONLY phase that lets a worker through: a born-paused
      // run has never been 'pausing', so a `!== 'pausing'` guard would wave it
      // straight past its first checkpoint.
      if (phase === 'running') return;
      if (phase === 'pausing') setPhase('paused');

      await new Promise<void>((resolve) => {
        continueRun = resolve;
      });
    },
  };
}
