import { useSyncExternalStore } from 'react';

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
// ---------------------------------------------------------------------------

export type BackgroundJobKind = 'sync' | 'embed' | 'tag' | 'transcribe';

export interface BackgroundJob {
  /** Platform key — reuses the collection library's logTag (e.g. 'zhihu-favorites'). */
  platform: string;
  kind: BackgroundJobKind;
  running: boolean;
  /**
   * Kind/platform-specific payload set by the runner via setProgress. For sync
   * it is the platform's TProgress; for embed/tag it is {done,total}. Held as
   * unknown so the store stays platform-agnostic — consumers cast on read.
   * null = indeterminate or not yet reported.
   */
  progress: unknown;
  /** Last run's raw thrown value (consumers classify on read); reset on next start. */
  error: unknown;
  /** Bumped once per successful completion — a mounted consumer watches this to
   *  refresh derived data (meta/query) it owns after a sync it didn't observe end. */
  generation: number;
}

const jobs = new Map<string, BackgroundJob>();
const listeners = new Set<() => void>();
const trackedRunGroups = new Map<string, { active: number; error: unknown }>();

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
export function getJob(platform: string, kind: BackgroundJobKind): BackgroundJob | null {
  return jobs.get(keyOf(platform, kind)) ?? null;
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
 * Start a background job, re-entrant safe: a call while this platform+kind is
 * already running is a no-op (cross-mount dedupe — this is what a component-local
 * guard cannot do). The runner receives a setProgress sink; throwing surfaces as
 * job.error, success bumps generation. Fire-and-forget, no AbortSignal — closing
 * app.html kills the page and pending work resumes semantics live in the queues.
 */
export function startJob(
  platform: string,
  kind: BackgroundJobKind,
  runner: (setProgress: (progress: unknown) => void) => Promise<void>,
): void {
  const key = keyOf(platform, kind);
  const existing = jobs.get(key);
  if (existing?.running) return;

  setJob(key, {
    platform,
    kind,
    running: true,
    progress: null,
    error: null,
    generation: existing?.generation ?? 0,
  });

  const setProgress = (progress: unknown): void => {
    const cur = jobs.get(key);
    if (!cur || !cur.running) return;
    setJob(key, { ...cur, progress });
  };

  void runner(setProgress)
    .then(() => {
      const cur = jobs.get(key);
      if (!cur) return;
      setJob(key, { ...cur, running: false, progress: null, generation: cur.generation + 1 });
    })
    .catch((err: unknown) => {
      console.error(`[background-jobs] ${key} failed:`, err);
      const cur = jobs.get(key);
      if (!cur) return;
      setJob(key, { ...cur, running: false, progress: null, error: err });
    });
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
      running: true,
      progress: null,
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
    if (!currentJob) return;
    setJob(key, {
      ...currentJob,
      running: false,
      progress: null,
      error: currentGroup.error,
      generation:
        currentGroup.error == null ? currentJob.generation + 1 : currentJob.generation,
    });
  };

  void run.then(() => settle(null), settle);
}

/** Subscribe to a single platform+kind job (null until first started). */
export function useJob(platform: string, kind: BackgroundJobKind): BackgroundJob | null {
  return useSyncExternalStore(subscribe, () => getJob(platform, kind));
}

/** Subscribe to the list of running jobs (stable ref → drives the reminder detail). */
export function useRunningJobs(): BackgroundJob[] {
  return useSyncExternalStore(subscribe, getRunningJobs);
}
