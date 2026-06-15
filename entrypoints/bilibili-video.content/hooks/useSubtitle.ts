import { useEffect, useState } from 'react';
import { fetchBilibiliSubtitle } from '@/lib/bilibili/subtitle-fetcher';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import type { SubtitleRow, SubtitleDataMessage } from '@/lib/types';

interface SubtitleState {
  rows: SubtitleRow[];
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
}

const INTERCEPT_TIMEOUT = 3000;
const API_RETRY_DELAY = 3500;
const MAX_API_RETRIES = 2;

/**
 * Fetch subtitles when bvid + cid become available.
 *
 * Dual-channel approach (aligned with Bilitato):
 *   1. Listen for BILI_SUBTITLE_DATA postMessage from inject script
 *   2. If no data within 3s, fallback to fetchBilibiliSubtitle() API
 *   3. If API returns no_subtitle/error, retry up to MAX_API_RETRIES times
 *
 * The inject script re-emits cached subtitle data every ~1s,
 * so Channel 1 should succeed even for late-mounting content scripts.
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
    let retryCount = 0;

    setState({ rows: [], loading: true, status: null, error: null });

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const msg = event.data as SubtitleDataMessage | undefined;
      if (msg?.type !== 'BILI_SUBTITLE_DATA') return;
      if (cancelled || resolved) return;
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

    function attemptApiFetch() {
      if (cancelled || resolved) return;

      fallbackTimer = setTimeout(() => {
        if (cancelled || resolved) return;

        (async () => {
          try {
            const result = await fetchBilibiliSubtitle(bvid!, cid!);
            if (cancelled || resolved) return;

            if (result.status === 'ok' && result.rows.length > 0) {
              resolved = true;
              const processed = processSubtitles(result.rows);
              setState({
                rows: processed,
                loading: false,
                status: processed.length > 0 ? 'ok' : 'no_subtitle',
                error: null,
              });
            } else if (retryCount < MAX_API_RETRIES) {
              retryCount++;
              attemptApiFetch();
            } else {
              resolved = true;
              setState({
                rows: [],
                loading: false,
                status: result.status,
                error: result.error ?? null,
              });
            }
          } catch (err) {
            if (cancelled || resolved) return;

            if (retryCount < MAX_API_RETRIES) {
              retryCount++;
              attemptApiFetch();
            } else {
              resolved = true;
              setState({
                rows: [],
                loading: false,
                status: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          }
        })();
      }, retryCount === 0 ? INTERCEPT_TIMEOUT : API_RETRY_DELAY);
    }

    attemptApiFetch();

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [bvid, cid]);

  return state;
}
