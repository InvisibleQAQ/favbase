import { useEffect, useState } from 'react';
import { fetchBilibiliSubtitle } from '@/lib/bilibili/subtitle-fetcher';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import type { SubtitleRow, SubtitleDataMessage } from '@/lib/types';

interface SubtitleState {
  rows: SubtitleRow[];
  loading: boolean;
  /** null = not yet loaded; 'ok' = has subtitles; 'no_subtitle' = API returned none; 'error' = fetch failed */
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
}

/** Timeout (ms) to wait for intercepted subtitle data before falling back to API. */
const INTERCEPT_TIMEOUT = 3000;

/**
 * Fetch subtitles when bvid + cid become available.
 *
 * Dual-channel approach (aligned with Bilitato):
 *   1. Listen for BILI_SUBTITLE_DATA postMessage from the main-world inject script
 *      (passively captured from the player's own fetch/XHR).
 *   2. If no data arrives within 3 seconds, fall back to fetchBilibiliSubtitle() API.
 *
 * Both channels feed through the subtitle processor pipeline.
 */
export function useSubtitle(bvid: string | null, cid: number | null): SubtitleState {
  const [state, setState] = useState<SubtitleState>({
    rows: [],
    loading: false,
    status: null,
    error: null,
  });

  useEffect(() => {
    if (!bvid || !cid) return;

    let cancelled = false;
    let resolved = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    setState({ rows: [], loading: true, status: null, error: null });

    // --- Channel 1: postMessage from main-world inject script ---
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const msg = event.data as SubtitleDataMessage | undefined;
      if (msg?.type !== 'BILI_SUBTITLE_DATA') return;
      if (cancelled || resolved) return;

      // Validate the data is for the current video
      if (msg.bvid !== bvid) return;

      resolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);

      const processed = processSubtitles(msg.data);

      setState({
        rows: processed,
        loading: false,
        status: processed.length > 0 ? 'ok' : 'no_subtitle',
        error: null,
      });
    }

    window.addEventListener('message', onMessage);

    // --- Channel 2: API fallback after timeout ---
    fallbackTimer = setTimeout(() => {
      if (cancelled || resolved) return;

      (async () => {
        try {
          const result = await fetchBilibiliSubtitle(bvid, cid);
          if (cancelled || resolved) return;
          resolved = true;

          if (result.status === 'ok' && result.rows.length > 0) {
            // API returns already-converted format (start/end/text);
            // processSubtitles accepts both formats.
            const processed = processSubtitles(result.rows);
            setState({
              rows: processed,
              loading: false,
              status: processed.length > 0 ? 'ok' : 'no_subtitle',
              error: null,
            });
          } else {
            setState({
              rows: [],
              loading: false,
              status: result.status,
              error: result.error ?? null,
            });
          }
        } catch (err) {
          if (cancelled || resolved) return;
          resolved = true;

          setState({
            rows: [],
            loading: false,
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      })();
    }, INTERCEPT_TIMEOUT);

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [bvid, cid]);

  return state;
}
