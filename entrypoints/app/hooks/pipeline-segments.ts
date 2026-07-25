import type {
  ProcessingCoverage,
  ProcessingCoverageCount,
} from '@/lib/collections';

import type { PipelineProgressSegment } from '../components/collection';

export interface BuildPipelineSegmentInput {
  id: string;
  label: string;
  idle: ProcessingCoverageCount;
  running: boolean;
  progress?: ProcessingCoverageCount | null;
  error?: boolean;
  coverageStatus?: ProcessingCoverageStatus;
}

export type ProcessingCoverageStatus = 'loading' | 'ready' | 'error';

export interface PipelineRuntimeSnapshot {
  running: boolean;
  progress?: unknown;
  error?: unknown;
}

export interface PipelineStageInput {
  id: string;
  label: string;
  coverage: keyof ProcessingCoverage;
  runtime?: PipelineRuntimeSnapshot | null;
}

export interface BuildPipelineSegmentsInput {
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  stages: PipelineStageInput[];
}

/** Runtime progress wins only while a stage is active; idle always reflects DB coverage. */
export function buildPipelineSegment({
  id,
  label,
  idle,
  running,
  progress,
  error = false,
  coverageStatus = 'ready',
}: BuildPipelineSegmentInput): PipelineProgressSegment {
  const count = running && progress
    ? progress
    : coverageStatus === 'ready'
      ? idle
      : { done: null, total: null };
  return {
    id,
    label,
    done: count.done,
    total: count.total,
    state: error
      ? 'error'
      : running
        ? 'running'
        : coverageStatus === 'ready'
          ? 'idle'
          : coverageStatus,
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
    return buildPipelineSegment({
      id: stage.id,
      label: stage.label,
      idle: coverage[stage.coverage],
      running: runtime?.running ?? false,
      progress: readJobProgress(runtime?.progress),
      error: runtime?.error != null,
      coverageStatus,
    });
  });
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
