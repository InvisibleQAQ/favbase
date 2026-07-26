import type {
  ProcessingCoverage,
  ProcessingCoverageCount,
} from '@/lib/collections';
import type { LocaleKeys } from '@/lib/i18n';

import type {
  PipelineProgressSegment,
  PipelineSegmentControl,
  PipelineSegmentState,
} from '../components/collection';
import {
  pauseJob,
  resumeJob,
  type BackgroundJob,
} from './background-jobs-store';

export interface BuildPipelineSegmentInput {
  id: string;
  label: string;
  idle: ProcessingCoverageCount;
  running: boolean;
  phase?: PipelineRuntimePhase;
  progress?: ProcessingCoverageCount | null;
  terminalProgress?: ProcessingCoverageCount | null;
  percent?: number | null;
  control?: PipelineSegmentControl;
  error?: boolean;
  coverageStatus?: ProcessingCoverageStatus;
}

export type ProcessingCoverageStatus = 'loading' | 'ready' | 'error';
export type PipelineRuntimePhase =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed';

export interface PipelineControlLabels {
  pause: string;
  pausing: string;
  resume: string;
}

export interface PipelineRuntimeSnapshot {
  phase?: PipelineRuntimePhase;
  running: boolean;
  progress?: unknown;
  lastProgress?: unknown;
  error?: unknown;
  pause?: () => void;
  resume?: () => void;
  controlLabels?: PipelineControlLabels;
}

export interface PipelineStageInput {
  id: string;
  label: string;
  coverage: keyof ProcessingCoverage;
  completedProgress?: 'last-run';
  runtime?: PipelineRuntimeSnapshot | null;
}

export interface BuildPipelineSegmentsInput {
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  stages: PipelineStageInput[];
}

/** Add the shared cooperative controls to a worker-backed job snapshot. */
export function backgroundJobRuntime<TProgress = unknown>(
  job: BackgroundJob<TProgress> | null,
  controlLabels: PipelineControlLabels,
  progressAdapter: (progress: TProgress | null) => ProcessingCoverageCount | null =
    (progress) => readJobProgress(progress),
): PipelineRuntimeSnapshot | null {
  if (!job) return null;
  return {
    phase: job.phase,
    running: job.running,
    progress: progressAdapter(job.progress),
    lastProgress: progressAdapter(job.lastProgress),
    error: job.error,
    pause: () => pauseJob(job.platform, job.kind),
    resume: () => resumeJob(job.platform, job.kind),
    controlLabels,
  };
}

export function pipelineControlLabels(
  translate: (key: LocaleKeys, params?: Record<string, string | number>) => string,
  stage: string,
): PipelineControlLabels {
  return {
    pause: translate('pipeline.control.pause', { stage }),
    pausing: translate('pipeline.control.pausing', { stage }),
    resume: translate('pipeline.control.resume', { stage }),
  };
}

/** Runtime progress wins only while a stage is active; idle always reflects DB coverage. */
export function buildPipelineSegment({
  id,
  label,
  idle,
  running,
  phase,
  progress,
  terminalProgress,
  percent,
  control,
  error = false,
  coverageStatus = 'ready',
}: BuildPipelineSegmentInput): PipelineProgressSegment {
  const active = running || phase === 'running' || phase === 'pausing' || phase === 'paused';
  const count = phase === 'completed' && terminalProgress
    ? terminalProgress
    : active && progress
    ? progress
    : coverageStatus === 'ready'
      ? idle
      : { done: null, total: null };
  return {
    id,
    label,
    done: count.done,
    total: count.total,
    ...(percent != null ? { percent } : {}),
    state: error || phase === 'failed'
      ? 'failed'
      : phase ?? (running
        ? 'running'
        : coverageStatus === 'error'
          ? 'failed'
          : coverageStatus === 'loading'
            ? 'loading'
            : 'idle'),
    ...(control ? { control } : {}),
  };
}

/** Map platform stage declarations to one consistent runtime/coverage contract. */
export function buildPipelineSegments({
  coverage,
  coverageStatus,
  stages,
}: BuildPipelineSegmentsInput): PipelineProgressSegment[] {
  return stages.map((stage) => {
    const runtime = stage.runtime;
    const retainedCompletion =
      stage.completedProgress === 'last-run' && runtime?.phase === 'completed'
        ? readJobProgress(runtime.lastProgress)
        : null;
    return buildPipelineSegment({
      id: stage.id,
      label: stage.label,
      idle: coverage[stage.coverage],
      running: runtime?.running ?? false,
      phase: runtime?.phase,
      progress: readJobProgress(runtime?.progress),
      terminalProgress: retainedCompletion,
      percent: retainedCompletion ? 100 : null,
      control: readRuntimeControl(runtime),
      error: runtime?.error != null,
      coverageStatus,
    });
  });
}

function readRuntimeControl(
  runtime: PipelineRuntimeSnapshot | null | undefined,
): PipelineSegmentControl | undefined {
  if (!runtime?.pause || !runtime.resume || !runtime.controlLabels) return undefined;

  if (runtime.phase === 'pausing') {
    return {
      kind: 'pausing',
      label: runtime.controlLabels.pausing,
      disabled: true,
    };
  }
  if (runtime.phase === 'paused') {
    return {
      kind: 'resume',
      label: runtime.controlLabels.resume,
      disabled: false,
      onClick: runtime.resume,
    };
  }
  if (runtime.phase === 'running' || (runtime.phase == null && runtime.running)) {
    return {
      kind: 'pause',
      label: runtime.controlLabels.pause,
      disabled: false,
      onClick: runtime.pause,
    };
  }
  return undefined;
}

/** Narrow the background store's intentionally-unknown progress payload. */
export function readJobProgress(value: unknown): ProcessingCoverageCount | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.done !== 'number' ||
    !Number.isFinite(candidate.done) ||
    candidate.done < 0 ||
    (candidate.total !== null &&
      (typeof candidate.total !== 'number' ||
        !Number.isFinite(candidate.total) ||
        candidate.total < 0))
  ) {
    return null;
  }
  return { done: candidate.done, total: candidate.total as number | null };
}
