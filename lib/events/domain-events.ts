/**
 * Typed in-memory domain event bus: "persistent data changed → UI refresh"
 * notifications within a single JS context (app.html). Session-ephemeral
 * state (transcription progress) stays on its coordinator push model — this
 * bus is only for DB-backed facts that change outside React's sight.
 */

export interface DomainEventMap {
  'item-tagged': { platform: string; platformItemId: string };
}

export type DomainEventType = keyof DomainEventMap;

type DomainEventListener<T extends DomainEventType> = (payload: DomainEventMap[T]) => void;

// Internal storage erases the per-event payload type (TS cannot correlate a
// generic key with its mapped value on assignment — the mitt/nanoevents
// pattern). The public on/emit generics keep the type↔payload link sound.
type StoredListener = (payload: DomainEventMap[DomainEventType]) => void;

const listeners = new Map<DomainEventType, Set<StoredListener>>();

/** Subscribe to a domain event. Returns the unsubscribe function. */
export function onDomainEvent<T extends DomainEventType>(
  type: T,
  listener: DomainEventListener<T>,
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  const stored = listener as StoredListener;
  set.add(stored);
  return () => {
    set.delete(stored);
  };
}

/**
 * Emit a domain event. Listener errors are logged and swallowed so a UI
 * subscriber bug can never corrupt the emitting write path's result.
 */
export function emitDomainEvent<T extends DomainEventType>(
  type: T,
  payload: DomainEventMap[T],
): void {
  listeners.get(type)?.forEach((listener) => {
    try {
      listener(payload);
    } catch (err) {
      console.error('[events] Listener for %s threw:', type, err);
    }
  });
}
