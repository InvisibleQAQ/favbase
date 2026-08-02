import { useCallback, useSyncExternalStore } from 'react';

// Pure discriminator module (no DB imports) — the barrel would drag drizzle in.
import { isCollectionPlatform, type CollectionPlatform } from '@/lib/collections/platforms';
import { libraryGateStorage } from '@/lib/storage';

import {
  pauseJob,
  resumeJob,
  setJobGate,
  type BackgroundJobKind,
} from './background-jobs-store';
import {
  collectionPlatformForJob,
  jobPlatformForCollection,
} from './collection-job-platform';

// ---------------------------------------------------------------------------
// Per-platform knowledge-base build gate.
//
// This is the platform-AWARE layer of app/hooks (same tier as
// auto-sync-registry.ts): it reads storage and knows the platform vocabulary.
// The generic layer (background-jobs-store / pipeline-run-control) never
// imports it — the gate pushes itself in through setJobGate instead.
//
// The persisted value is the list of PAUSED platforms, so `[]` = everything
// runs and platform N+1 needs no default entry. A synchronous module-level
// mirror exists because `startJob` is not React and must decide born-paused vs
// born-running in the same tick it creates the run.
// ---------------------------------------------------------------------------

export const gatePlatformOf = collectionPlatformForJob;

/** Every job kind a paused platform must stop producing. */
const GATED_JOB_KINDS: BackgroundJobKind[] = [
  'sync',
  'extract',
  'embed',
  'tag',
  'transcribe',
];

let pausedPlatforms: ReadonlySet<CollectionPlatform> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameSet(
  a: ReadonlySet<CollectionPlatform>,
  b: ReadonlySet<CollectionPlatform>,
): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Swap the mirror, sync live runs, and notify — no-op when the value is
 * unchanged (watch echo). The pause/resume fan-out lives HERE (diff-driven)
 * so the click path and a cross-context write (another app.html tab) behave
 * identically; pause()/resume() are phase-guarded no-ops when there is no
 * matching live run (e.g. the initial persisted read at module load).
 */
function applyPaused(next: Set<CollectionPlatform>): void {
  if (sameSet(pausedPlatforms, next)) return;
  const prev = pausedPlatforms;
  pausedPlatforms = next;
  for (const platform of next) {
    if (!prev.has(platform)) fanOutGate(platform, pauseJob);
  }
  for (const platform of prev) {
    if (!next.has(platform)) fanOutGate(platform, resumeJob);
  }
  for (const listener of listeners) listener();
}

function fanOutGate(
  platform: CollectionPlatform,
  action: (jobPlatform: string, kind: BackgroundJobKind) => void,
): void {
  const jobPlatform = jobPlatformForCollection(platform);
  for (const kind of GATED_JOB_KINDS) action(jobPlatform, kind);
}

/** Drop anything that is no longer a known platform (stale persisted value). */
function sanitize(list: readonly string[] | null | undefined): Set<CollectionPlatform> {
  const next = new Set<CollectionPlatform>();
  for (const value of list ?? []) if (isCollectionPlatform(value)) next.add(value);
  return next;
}

/** Synchronous read for non-React callers (`startJob`, the daily coordinator). */
export function isLibraryPaused(jobPlatform: string): boolean {
  const gate = gatePlatformOf(jobPlatform);
  return gate != null && pausedPlatforms.has(gate);
}

function setLibraryPaused(platform: CollectionPlatform, paused: boolean): Promise<void> {
  const next = new Set(pausedPlatforms);
  if (paused) next.add(platform);
  else next.delete(platform);
  // Mirror (+ live-run fan-out) first: startJob reads the mirror synchronously,
  // so persistence must not race a dispatch triggered in the same tick as the
  // click. applyPaused owns the pauseJob/resumeJob fan-out.
  applyPaused(next);

  return libraryGateStorage.setValue([...next]).catch((err: unknown) => {
    console.error('[library-gate] persist failed:', err);
  });
}

/** Pause one platform's pipeline: gate future dispatch + pause its live runs. */
export function pauseLibrary(platform: CollectionPlatform): Promise<void> {
  return setLibraryPaused(platform, true);
}

/** Resume one platform: ungate dispatch + release its paused runs where they stopped. */
export function resumeLibrary(platform: CollectionPlatform): Promise<void> {
  return setLibraryPaused(platform, false);
}

export interface LibraryGateState {
  paused: boolean;
  pause: () => void;
  resume: () => void;
}

export function useLibraryGate(platform: CollectionPlatform): LibraryGateState {
  const paused = useSyncExternalStore(subscribe, () => pausedPlatforms.has(platform));
  const pause = useCallback(() => {
    void pauseLibrary(platform);
  }, [platform]);
  const resume = useCallback(() => {
    void resumeLibrary(platform);
  }, [platform]);

  return { paused, pause, resume };
}

// Self-registration: the generic job store must not import this module, so the
// dependency flows the other way. use-daily-auto-sync (mounted by App.tsx)
// imports this file, which is what guarantees the load in app.html.
setJobGate(isLibraryPaused);

void libraryGateStorage
  .getValue()
  .then((list) => applyPaused(sanitize(list)))
  .catch((err: unknown) => {
    console.error('[library-gate] initial read failed:', err);
  });

// Cross-context / cross-tab updates (and the echo of our own write).
libraryGateStorage.watch((list) => applyPaused(sanitize(list)));
