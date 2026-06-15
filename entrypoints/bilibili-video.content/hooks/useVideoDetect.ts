import { useEffect, useState } from 'react';
import { extractBvid, extractPageNum, fetchVideoInfo, getCidForPage } from '@/lib/bilibili/video-info';

interface VideoDetection {
  bvid: string | null;
  cid: number | null;
  title: string;
  loading: boolean;
  error: string | null;
}

/**
 * Detect the current bilibili video from URL, fetch CID via API.
 *
 * Does NOT watch for SPA navigation — user must refresh for new video.
 * (SPA monitoring is planned for a later step.)
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

    (async () => {
      try {
        const info = await fetchVideoInfo(bvid);
        if (cancelled) return;

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
        if (cancelled) return;
        setState({
          bvid,
          cid: null,
          title: '',
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch video info',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
