import { initDbMain } from '@/lib/database/db';
import type { SubsystemState } from './types';

let status: SubsystemState = 'pending';

// initDbMain() registers the port RPC listener synchronously (before any
// await), so calling it here at document load keeps the ready-gate timing.
export function start(): void {
  initDbMain()
    .then(() => { status = 'ready'; })
    .catch((err) => {
      status = 'failed';
      console.error('[offscreen] PGlite init failed:', err);
    });
}

export function getState(): SubsystemState {
  return status;
}
