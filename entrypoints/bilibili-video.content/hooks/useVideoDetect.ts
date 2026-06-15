import { useEffect, useState } from 'react';
import { extractBvid, extractPageNum, fetchVideoInfo, getCidForPage } from '@/lib/bilibili/video-info';
import type { SubtitleHandshakeMessage } from '@/lib/types';

interface VideoDetection {
  bvid: string | null;
  cid: number | null;
  title: string;
  loading: boolean;
  error: string | null;
}

/** Timeout (ms) to wait for main-world handshake before falling back to API. */
const HANDSHAKE_TIMEOUT = 3000;

/**
 * Detect the current bilibili video.
 *
 * Priority:
 *   1. postMessage HANDSHAKE from main-world inject script (reads __INITIAL_STATE__)
 *   2. Fallback: fetch /x/web-interface/view API after 3s timeout
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
    const bvid = extractBvid(window.location.href);

    if (!bvid) {
      setState({ bvid: null, cid: null, title: '', loading: false, error: 'No BV number found in URL' });
      return;
    }

    let cancelled = false;
    let resolved = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // --- Channel 1: postMessage from main-world inject script ---
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const msg = event.data as SubtitleHandshakeMessage | undefined;
      if (msg?.type !== 'BILI_SUBTITLE_HANDSHAKE') return;
      if (cancelled || resolved) return;

      // Validate that the handshake is for the current video
      if (msg.bvid !== bvid) return;

      resolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);

      setState({
        bvid: msg.bvid,
        cid: msg.cid || null,
        title: '', // title not available from handshake; will be empty until API provides it
        loading: false,
        error: null,
      });
    }

    window.addEventListener('message', onMessage);

    // --- Channel 2: API fallback after timeout ---
    fallbackTimer = setTimeout(() => {
      if (cancelled || resolved) return;

      (async () => {
        try {
          const info = await fetchVideoInfo(bvid);
          if (cancelled || resolved) return;
          resolved = true;

          const pageNum = extractPageNum(window.location.href);
          const cid = getCidForPage(info, pageNum);

          setState({
            bvid: info.bvid,
            cid,
            title: info.title,
            loading: false,
            error: null,
          });
        } catch (err) {
          if (cancelled || resolved) return;
          resolved = true;

          setState({
            bvid,
            cid: null,
            title: '',
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to fetch video info',
          });
        }
      })();
    }, HANDSHAKE_TIMEOUT);

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, []);

  return state;
}
