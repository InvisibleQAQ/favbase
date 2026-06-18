import { useEffect, useState } from 'react';
import { extractBvid, extractPageNum, fetchCidByPageList } from '@/lib/bilibili/video-info';
import { onBiliMessage } from '@/lib/bilibili/messaging';

interface VideoDetection {
  bvid: string | null;
  cid: number | null;
  title: string;
  loading: boolean;
  error: string | null;
}

const HANDSHAKE_TIMEOUT = 3000;

/**
 * Detect the current bilibili video, with SPA navigation support.
 *
 * Listens for postMessage events from the main-world inject script:
 *   - BILI_ROUTE_SWITCH: SPA navigation detected, reset and await new handshake
 *   - BILI_SUBTITLE_HANDSHAKE: bvid + cid resolved from __INITIAL_STATE__
 *
 * The inject script re-emits HANDSHAKE every ~1s for the first 10s,
 * so even late-mounting content scripts will receive it.
 *
 * Fallback: /x/player/pagelist API (simpler than /x/web-interface/view,
 * doesn't require WBI signature).
 */
export function useVideoDetect(): VideoDetection {
  const [state, setState] = useState<VideoDetection>({
    bvid: null,
    cid: null,
    title: '',
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let currentBvid = extractBvid(window.location.href);
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    function clearFallback() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }

    function startFallbackTimer() {
      clearFallback();
      const bvid = currentBvid;
      fallbackTimer = setTimeout(() => {
        if (cancelled || resolved) return;

        (async () => {
          try {
            const pageNum = extractPageNum(window.location.href);
            const cid = await fetchCidByPageList(bvid!, pageNum);
            if (cancelled || resolved || currentBvid !== bvid) return;
            resolved = true;

            setState({
              bvid,
              cid,
              title: '',
              loading: false,
              error: null,
            });
          } catch (err) {
            if (cancelled || resolved || currentBvid !== bvid) return;
            resolved = true;

            setState({
              bvid,
              cid: null,
              title: '',
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to resolve CID',
            });
          }
        })();
      }, HANDSHAKE_TIMEOUT);
    }

    function startDetectionCycle(bvid: string | null) {
      resolved = false;
      clearFallback();

      if (!bvid) {
        setState({ bvid: null, cid: null, title: '', loading: false, error: 'No BV number found in URL' });
        return;
      }

      currentBvid = bvid;
      setState({ bvid: null, cid: null, title: '', loading: true, error: null });
      startFallbackTimer();
    }

    const unsubRouteSwitch = onBiliMessage('BILI_ROUTE_SWITCH', (payload) => {
      if (cancelled) return;
      startDetectionCycle(payload.bvid || extractBvid(window.location.href));
    });

    const unsubHandshake = onBiliMessage('BILI_SUBTITLE_HANDSHAKE', (payload) => {
      if (cancelled) return;
      if (payload.bvid !== currentBvid) return;

      const newCid = payload.cid || null;
      if (newCid) {
        resolved = true;
        clearFallback();
        setState({
          bvid: payload.bvid,
          cid: newCid,
          title: '',
          loading: false,
          error: null,
        });
      }
    });

    startDetectionCycle(currentBvid);

    return () => {
      cancelled = true;
      unsubRouteSwitch();
      unsubHandshake();
      clearFallback();
    };
  }, []);

  return state;
}
