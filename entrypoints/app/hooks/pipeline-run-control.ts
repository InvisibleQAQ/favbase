import type { CooperativeCheckpoint } from '@/lib/collections';

export type PipelineRunPhase = 'running' | 'pausing' | 'paused';

export interface PipelineRunControl extends CooperativeCheckpoint {
  getPhase: () => PipelineRunPhase;
  pause: () => void;
  resume: () => void;
  checkpoint: () => Promise<void>;
}

export function createPipelineRunControl(
  onPhaseChange: (phase: PipelineRunPhase) => void,
): PipelineRunControl {
  let phase: PipelineRunPhase = 'running';
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
      if (phase !== 'paused') return;
      setPhase('running');
      continueRun?.();
      continueRun = null;
    },
    checkpoint: async () => {
      if (phase !== 'pausing') return;

      setPhase('paused');
      await new Promise<void>((resolve) => {
        continueRun = resolve;
      });
    },
  };
}
