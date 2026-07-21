import type { ExtractionProgress } from '@/lib/bookmarks/bookmark-content-service';

export type ExtractionPhase = 'idle' | 'running' | 'pausing' | 'paused';

export interface ExtractionControlSnapshot {
  pauseRequested: boolean;
  pauseYielded: boolean;
  lastProgress: ExtractionProgress | null;
}

let controller: AbortController | null = null;
let snapshot: ExtractionControlSnapshot = {
  pauseRequested: false,
  pauseYielded: false,
  lastProgress: null,
};
const listeners = new Set<() => void>();

function update(next: ExtractionControlSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeExtractionControl(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExtractionControlSnapshot(): ExtractionControlSnapshot {
  return snapshot;
}

export function beginExtractionRun(): AbortSignal {
  controller = new AbortController();
  update({ pauseRequested: false, pauseYielded: false, lastProgress: null });
  return controller.signal;
}

export function recordExtractionProgress(progress: ExtractionProgress): void {
  update({ ...snapshot, lastProgress: progress });
}

export function requestExtractionPause(): void {
  if (!controller || controller.signal.aborted) return;
  controller.abort();
  update({ ...snapshot, pauseRequested: true });
}

export function finishExtractionRun(): void {
  const progress = snapshot.lastProgress;
  const pauseYielded =
    snapshot.pauseRequested && progress !== null && progress.done < progress.total;
  controller = null;
  update({
    ...snapshot,
    pauseRequested: pauseYielded,
    pauseYielded,
  });
}

export function deriveExtractionPhase(
  running: boolean,
  control: ExtractionControlSnapshot,
): ExtractionPhase {
  if (running) return control.pauseRequested ? 'pausing' : 'running';
  return control.pauseYielded ? 'paused' : 'idle';
}
