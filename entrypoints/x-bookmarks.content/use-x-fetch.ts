import { useCallback, useEffect, useRef, useState } from 'react';

import type { XSyncPush, XSyncError } from '@/lib/x/x-messages';
import type { SyncBookmarksResult } from '@/lib/x/x-sync-service';

export type XFetchPhase = 'idle' | 'fetching' | 'done' | 'error';

export interface XFetchState {
  phase: XFetchPhase;
  /** Running count during fetch (cursor pagination — total is unknowable). */
  fetchedCount: number;
  result: SyncBookmarksResult | null;
  error: XSyncError | null;
}

/** How long the ✓ done pill lingers before collapsing back to the idle button. */
const DONE_AUTOHIDE_MS = 5000;

const IDLE: XFetchState = { phase: 'idle', fetchedCount: 0, result: null, error: null };

/**
 * Drives the on-page fetch button. Clicking sends `X_SYNC_START` to the
 * background SW, which runs the sync in the Offscreen document and streams
 * `X_SYNC_PUSH` lifecycle messages back to this tab (fetching → done/error).
 * The button itself never touches PGlite or the X API.
 */
export function useXFetch(): XFetchState & { start: () => void } {
  const [state, setState] = useState<XFetchState>(IDLE);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoHide = () => {
    if (autoHideTimer.current) {
      clearTimeout(autoHideTimer.current);
      autoHideTimer.current = null;
    }
  };

  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as XSyncPush;
      if (m?.type !== 'X_SYNC_PUSH') return;

      if (m.phase === 'fetching') {
        setState((prev) => ({ ...prev, phase: 'fetching', fetchedCount: m.fetchedCount, error: null }));
      } else if (m.phase === 'done') {
        clearAutoHide();
        setState({ phase: 'done', fetchedCount: m.result.total, result: m.result, error: null });
        autoHideTimer.current = setTimeout(() => setState(IDLE), DONE_AUTOHIDE_MS);
      } else if (m.phase === 'error') {
        // Page console (F12) — the pill only shows a short label, so keep the
        // structured error reachable for diagnosis.
        console.warn('[favbase] X bookmarks sync failed:', JSON.stringify(m.error));
        setState((prev) => ({ ...prev, phase: 'error', error: m.error }));
      }
    };

    browser.runtime.onMessage.addListener(handler);
    return () => {
      browser.runtime.onMessage.removeListener(handler);
      clearAutoHide();
    };
  }, []);

  const start = useCallback(() => {
    clearAutoHide();
    setState({ phase: 'fetching', fetchedCount: 0, result: null, error: null });
    // Terminal state arrives via X_SYNC_PUSH; this only catches messaging faults.
    browser.runtime.sendMessage({ type: 'X_SYNC_START' }).catch((err: Error) => {
      setState({
        phase: 'error',
        fetchedCount: 0,
        result: null,
        error: { kind: 'unknown', message: err?.message ?? 'message failed' },
      });
    });
  }, []);

  return { ...state, start };
}
