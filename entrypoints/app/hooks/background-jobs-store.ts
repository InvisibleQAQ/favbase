import { useSyncExternalStore } from 'react';

import type { CooperativeCheckpoint } from '@/lib/collections';

import {
  createPipelineRunControl,
  type PipelineRunControl,
  type PipelineRunPhase,
} from './pipeline-run-control';

// ---------------------------------------------------------------------------
// Module-level singleton store for long-running background work (sync / embed /
// tag) across all collection platforms. Mirrors the proven use-bookmark-
// extraction pattern (bare module state + listener Set + useSyncExternalStore).
//
// Why module scope, NOT hook state: app.html is a Hash-Router page whose JS
// context survives route switches — only the section component unmounts. Holding
// job state here means navigating away and back re-subscribes to the SAME
// in-flight job (progress reconnects) instead of losing it, and the running
// guard dedupes across mounts (a remount cannot start a second identical job).
//
// This module is ALSO the scheduler: what a collision with an active run means
// is an explicit per-dispatch policy ('drop' | 'queue' | 'coalesce'), never
// something callers reimplement with settled-promise retry loops. The store
// owns the pending queue, dequeues on settlement (success AND failure), and
// evaluates the library gate when a run actually starts — including at dequeue.
// ---------------------------------------------------------------------------

export type BackgroundJobKind = 'sync' | 'extract' | 'embed' | 'tag' | 'transcribe';
export type BackgroundJobPhase = PipelineRunPhase | 'completed' | 'failed';

export interface BackgroundJob<TProgress = unknown> {
  /** Platform key — reuses the collection library's logTag (e.g. 'zhihu-favorites'). */
  platform: string;
  kind: BackgroundJobKind;
  phase: BackgroundJobPhase;
  running: boolean;
  /**
   * Kind/platform-specific payload set by the runner via setProgress. For sync
   * it is the platform's TProgress; for embed/tag it is {done,total}. Held as
   * unknown so the store stays platform-agnostic — consumers cast on read.
   * null = indeterminate or not yet reported.
   */
  progress: TProgress | null;
  /** Final progress from the last successful run; never used as active progress. */
  lastProgress: TProgress | null;
  /** Last run's raw thrown value (consumers classify on read); reset on next start. */
  error: unknown;
  /** Bumped once per successful completion — a mounted consumer watches this to
   *  refresh derived data (meta/query) it owns after a sync it didn't observe end. */
  generation: number;
}

export type BackgroundJobRunner = (
  setProgress: (progress: unknown) => void,
  control: CooperativeCheckpoint,
) => Promise<void>;

/**
 * What to do when a dispatch finds the same platform+kind already running:
 * - 'drop': refuse — the active run already covers the caller (cross-mount
 *   dedupe for sync/extract). The handle reports `started: false`.
 * - 'queue': FIFO behind the active run; starts when it settles (success OR
 *   failure). Every queued runner eventually runs.
 * - 'coalesce': merge into the newest pending run that was itself dispatched
 *   with 'coalesce' (this call's runner is discarded), else behave like
 *   'queue'. Interchangeability is a property the dispatch declares, so a
 *   coalesce never merges into a 'queue' entry (e.g. a streaming drain) whose
 *   runner does different work — only whole-backlog-style runs absorb each
 *   other.
 */
export type JobCollisionPolicy = 'drop' | 'queue' | 'coalesce';

export type BackgroundJobDispatch = 'started' | 'queued' | 'coalesced' | 'dropped';

export interface BackgroundJobRunHandle {
  /** false only when the dispatch was refused (`collision: 'drop'` while active). */
  started: boolean;
  /** How the scheduler placed this dispatch. */
  dispatch: BackgroundJobDispatch;
  /**
   * Settles when this dispatch's run settles: the new run ('started'), this
   * caller's queued run ('queued'), the pending run it merged into
   * ('coalesced'), or the active run that caused the refusal ('dropped').
   */
  settled: Promise<void>;
}

interface PendingRun {
  platform: string;
  kind: BackgroundJobKind;
  runner: BackgroundJobRunner;
  /** Enqueued with 'coalesce' — later coalesce dispatches may merge into it. */
  coalescible: boolean;
  settled: Promise<void>;
  resolveSettled: () => void;
}

const jobs = new Map<string, BackgroundJob>();
const listeners = new Set<() => void>();
const trackedRunGroups = new Map<string, { active: number; error: unknown }>();
const activeRunOwners = new Map<string, symbol>();
const activeRunControls = new Map<string, PipelineRunControl>();
const activeRunSettlements = new Map<string, Promise<void>>();
const pendingRuns = new Map<string, PendingRun[]>();

/**
 * Reader for the per-platform library gate, INJECTED (never imported): this
 * store is the generic layer — react + type-only imports — and importing the
 * gate would drag storage + the platform discriminators into it.
 * `entrypoints/app/hooks/library-gate.ts` self-registers on module load.
 */
let jobGate: ((platform: string) => boolean) | null = null;

export function setJobGate(reader: ((platform: string) => boolean) | null): void {
  jobGate = reader;
}

function isGatePaused(platform: string): boolean {
  if (!jobGate) return false;
  try {
    return jobGate(platform);
  } catch (err) {
    // A broken gate must never take job dispatch down with it.
    console.error('[background-jobs] gate read failed:', err);
    return false;
  }
}

// Cached snapshot of the currently-running jobs. Recomputed only on mutation so
// useSyncExternalStore gets a referentially-stable array between changes (a fresh
// filter() per getSnapshot call would loop React). Single source for both the
// running list and the count.
let runningSnapshot: BackgroundJob[] = [];

function keyOf(platform: string, kind: BackgroundJobKind): string {
  return `${platform}:${kind}`;
}

function refreshRunningSnapshot(): void {
  const next: BackgroundJob[] = [];
  for (const job of jobs.values()) if (job.running) next.push(job);
  runningSnapshot = next;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace one job with a new object (identity change drives useSyncExternalStore). */
function setJob(key: string, job: BackgroundJob): void {
  jobs.set(key, job);
  refreshRunningSnapshot();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Plain read (also backs the hook). Returns a stable ref until the job changes. */
export function getJob<TProgress = unknown>(
  platform: string,
  kind: BackgroundJobKind,
): BackgroundJob<TProgress> | null {
  return (jobs.get(keyOf(platform, kind)) as BackgroundJob<TProgress> | undefined) ?? null;
}

/** Currently-running jobs (stable ref until a job changes). Backs the reminder. */
export function getRunningJobs(): BackgroundJob[] {
  return runningSnapshot;
}

/** Number of jobs currently running (drives the global "don't close" reminder). */
export function getRunningJobCount(): number {
  return runningSnapshot.length;
}

/**
 * Start a background job. What a collision with an active run means is the
 * caller-declared policy (default 'drop': a call while this platform+kind is
 * already running is a no-op — the cross-mount dedupe a component-local guard
 * cannot do). The runner receives a setProgress sink; throwing surfaces as
 * job.error, success bumps generation. Fire-and-forget, no AbortSignal — closing
 * app.html kills the page and pending work resumes semantics live in the queues.
 */
export function startJob(
  platform: string,
  kind: BackgroundJobKind,
  runner: BackgroundJobRunner,
  collision: JobCollisionPolicy = 'drop',
): BackgroundJobRunHandle {
  const key = keyOf(platform, kind);
  if (jobs.get(key)?.running) {
    if (collision === 'drop') {
      return {
        started: false,
        dispatch: 'dropped',
        settled: activeRunSettlements.get(key) ?? Promise.resolve(),
      };
    }
    const queue = pendingRuns.get(key) ?? [];
    if (queue.length === 0) pendingRuns.set(key, queue);
    if (collision === 'coalesce') {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        const entry = queue[i];
        if (entry.coalescible) {
          return { started: true, dispatch: 'coalesced', settled: entry.settled };
        }
      }
    }
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    queue.push({
      platform,
      kind,
      runner,
      coalescible: collision === 'coalesce',
      settled,
      resolveSettled,
    });
    return { started: true, dispatch: 'queued', settled };
  }
  return { started: true, dispatch: 'started', settled: beginRun(key, platform, kind, runner) };
}

/**
 * Occupy the key with a new run. The library gate is read HERE — at start time,
 * not enqueue time — so a queued run dequeued under a paused gate is born
 * 'paused' exactly like a direct dispatch. A gated platform still creates the
 * job and starts the runner — the run merely blocks at its first checkpoint;
 * refusing to start would resolve queued work into nothing.
 */
function beginRun(
  key: string,
  platform: string,
  kind: BackgroundJobKind,
  runner: BackgroundJobRunner,
): Promise<void> {
  const existing = jobs.get(key);
  const owner = Symbol(key);
  activeRunOwners.set(key, owner);
  const bornPaused = isGatePaused(platform);
  const control = createPipelineRunControl((phase) => {
    if (activeRunOwners.get(key) !== owner) return;
    const current = jobs.get(key);
    if (!current?.running) return;
    setJob(key, { ...current, phase });
  }, bornPaused ? 'paused' : 'running');
  activeRunControls.set(key, control);

  setJob(key, {
    platform,
    kind,
    phase: bornPaused ? 'paused' : 'running',
    running: true,
    progress: null,
    lastProgress: existing?.lastProgress ?? null,
    error: null,
    generation: existing?.generation ?? 0,
  });

  const setProgress = (progress: unknown): void => {
    if (activeRunOwners.get(key) !== owner) return;
    const cur = jobs.get(key);
    if (!cur || !cur.running) return;
    setJob(key, { ...cur, progress });
  };

  const releaseRun = (): boolean => {
    if (activeRunOwners.get(key) !== owner) return false;
    activeRunOwners.delete(key);
    activeRunControls.delete(key);
    return true;
  };

  const settled = runner(setProgress, { checkpoint: control.checkpoint })
    .then(() => {
      if (!releaseRun()) return;
      const cur = jobs.get(key);
      if (!cur) return;
      setJob(key, {
        ...cur,
        phase: 'completed',
        running: false,
        lastProgress: cur.progress,
        progress: null,
        generation: cur.generation + 1,
      });
    })
    .catch((err: unknown) => {
      console.error(`[background-jobs] ${key} failed:`, err);
      if (!releaseRun()) return;
      const cur = jobs.get(key);
      if (!cur) return;
      setJob(key, { ...cur, phase: 'failed', running: false, progress: null, error: err });
    })
    .finally(() => {
      if (activeRunSettlements.get(key) === settled) activeRunSettlements.delete(key);
      drainPending(key);
    });
  activeRunSettlements.set(key, settled);
  return settled;
}

/**
 * Dequeue-on-settlement. Runs in every run's settle continuation (startJob runs
 * AND trackJobRun groups), synchronously after the terminal setJob, so between
 * "key is free" and "next pending run occupies it" no external code can jump
 * the queue. If something re-occupied the key first (a synchronous listener),
 * the pending list stays intact — that run's own settlement drains it.
 */
function drainPending(key: string): void {
  if (jobs.get(key)?.running) return;
  const queue = pendingRuns.get(key);
  const next = queue?.shift();
  if (queue && queue.length === 0) pendingRuns.delete(key);
  if (!next) return;
  void beginRun(key, next.platform, next.kind, next.runner).finally(next.resolveSettled);
}

export function pauseJob(platform: string, kind: BackgroundJobKind): void {
  activeRunControls.get(keyOf(platform, kind))?.pause();
}

export function resumeJob(platform: string, kind: BackgroundJobKind): void {
  activeRunControls.get(keyOf(platform, kind))?.resume();
}

/**
 * Observe overlapping fire-and-forget promises as one lane. Unlike startJob,
 * this never dedupes work: it only keeps the job running until every tracked
 * promise for the platform+kind settles.
 */
export function trackJobRun(
  platform: string,
  kind: Extract<BackgroundJobKind, 'embed' | 'tag'>,
  run: Promise<unknown>,
): void {
  const key = keyOf(platform, kind);
  let group = trackedRunGroups.get(key);
  if (!group) {
    group = { active: 0, error: null };
    trackedRunGroups.set(key, group);
    const existing = jobs.get(key);
    setJob(key, {
      platform,
      kind,
      phase: 'running',
      running: true,
      progress: null,
      lastProgress: existing?.lastProgress ?? null,
      error: null,
      generation: existing?.generation ?? 0,
    });
  }
  group.active += 1;

  const settle = (error: unknown): void => {
    const currentGroup = trackedRunGroups.get(key);
    if (!currentGroup) return;
    if (error != null && currentGroup.error == null) currentGroup.error = error;
    currentGroup.active -= 1;
    if (currentGroup.active > 0) return;

    trackedRunGroups.delete(key);
    const currentJob = jobs.get(key);
    if (currentJob) {
      setJob(key, {
        ...currentJob,
        phase: currentGroup.error == null ? 'completed' : 'failed',
        running: false,
        progress: null,
        error: currentGroup.error,
        generation:
          currentGroup.error == null ? currentJob.generation + 1 : currentJob.generation,
      });
    }
    // A tracked group can hold a key that queued startJob dispatches wait on
    // (the 'bilibili:transcribe' key mixes observer and owner runs).
    drainPending(key);
  };

  void run.then(() => settle(null), settle);
}

/** Subscribe to a single platform+kind job (null until first started). */
export function useJob<TProgress = unknown>(
  platform: string,
  kind: BackgroundJobKind,
): BackgroundJob<TProgress> | null {
  return useSyncExternalStore(subscribe, () => getJob(platform, kind));
}

/** Subscribe to the list of running jobs (stable ref → drives the reminder detail). */
export function useRunningJobs(): BackgroundJob[] {
  return useSyncExternalStore(subscribe, getRunningJobs);
}
