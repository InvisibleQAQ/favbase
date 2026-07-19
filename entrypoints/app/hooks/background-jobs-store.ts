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

export type BackgroundJobKind = 'sync' | 'embed' | 'tag';

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

function keyOf(platform: string, kind: BackgroundJobKind): string {
  return `${platform}:${kind}`;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace one job with a new object (identity change drives useSyncExternalStore). */
function setJob(key: string, job: BackgroundJob): void {
  jobs.set(key, job);
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

/** Number of jobs currently running (drives the global "don't close" reminder). */
export function getRunningJobCount(): number {
  let count = 0;
  for (const job of jobs.values()) if (job.running) count += 1;
  return count;
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

/** Subscribe to a single platform+kind job (null until first started). */
export function useJob(platform: string, kind: BackgroundJobKind): BackgroundJob | null {
  return useSyncExternalStore(subscribe, () => getJob(platform, kind));
}

/** Subscribe to the running-job count (primitive → stable by value). */
export function useRunningJobCount(): number {
  return useSyncExternalStore(subscribe, getRunningJobCount);
}
