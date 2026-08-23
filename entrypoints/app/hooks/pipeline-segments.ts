import type {
  ProcessingCoverage,
  ProcessingCoverageCount,
} from '@/lib/collections';

import type { PipelineProgressSegment } from '../components/collection';
import type { BackgroundJob } from './background-jobs-store';

export interface BuildPipelineSegmentInput {
  id: string;
  label: string;
  idle: ProcessingCoverageCount;
  running: boolean;
  phase?: PipelineRuntimePhase;
  progress?: ProcessingCoverageCount | null;
  terminalProgress?: ProcessingCoverageCount | null;
  percent?: number | null;
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

export interface PipelineRuntimeSnapshot {
  phase?: PipelineRuntimePhase;
  running: boolean;
  progress?: unknown;
  lastProgress?: unknown;
  error?: unknown;
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

export interface CollectionPipelineLabels {
  fetch: string;
  embedding: string;
  tagging: string;
}

/** Platform content stage (readme / extraction / transcription) between Fetch and Embedding. */
export interface CollectionPipelineContentStage {
  id: string;
  label: string;
  runtime: PipelineRuntimeSnapshot | null;
}

export interface CollectionPipelineStagesInput {
  labels: CollectionPipelineLabels;
  fetch: PipelineRuntimeSnapshot | null;
  content?: CollectionPipelineContentStage | null;
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
}

/**
 * Map a worker-backed job to the display-only runtime snapshot. Pause/resume is
 * no longer a per-segment control — the per-platform library gate owns it.
 */
export function backgroundJobRuntime<TProgress = unknown>(
  job: BackgroundJob<TProgress> | null,
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
  };
}

/** Fetch progress adapter for sync jobs that report a running `fetchedCount` (remote total unknown). */
export function fetchedCountProgress(
  progress: { fetchedCount: number } | null,
): ProcessingCoverageCount | null {
  return progress ? { done: progress.fetchedCount, total: null } : null;
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
      error: runtime?.error != null,
      coverageStatus,
    });
  });
}

/**
 * The one declaration of a collection page's pipeline shape:
 * Fetch (acquisition, retains last run) → optional content stage → Embedding → Tagging.
 */
export function collectionPipelineStages({
  labels,
  fetch,
  content,
  embedJob,
  tagJob,
}: CollectionPipelineStagesInput): PipelineStageInput[] {
  return [
    {
      id: 'fetch',
      label: labels.fetch,
      coverage: 'acquisition',
      completedProgress: 'last-run',
      runtime: fetch,
    },
    ...(content
      ? [{ id: content.id, label: content.label, coverage: 'content' as const, runtime: content.runtime }]
      : []),
    {
      id: 'embedding',
      label: labels.embedding,
      coverage: 'embedding',
      runtime: backgroundJobRuntime(embedJob),
    },
    {
      id: 'tagging',
      label: labels.tagging,
      coverage: 'tagging',
      runtime: backgroundJobRuntime(tagJob),
    },
  ];
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
