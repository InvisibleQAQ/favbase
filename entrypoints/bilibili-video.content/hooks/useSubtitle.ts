import { useEffect, useState } from 'react';
import { fetchBilibiliSubtitle } from '@/lib/bilibili/subtitle-fetcher';
import type { SubtitleRow } from '@/lib/types';

interface SubtitleState {
  rows: SubtitleRow[];
  loading: boolean;
  /** null = not yet loaded; 'ok' = has subtitles; 'no_subtitle' = API returned none; 'error' = fetch failed */
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
}

/**
 * Fetch subtitles when bvid + cid become available.
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
    setState({ rows: [], loading: true, status: null, error: null });

    (async () => {
      try {
        const result = await fetchBilibiliSubtitle(bvid, cid);
        if (cancelled) return;

        setState({
          rows: result.rows,
          loading: false,
          status: result.status,
          error: result.error ?? null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          rows: [],
          loading: false,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bvid, cid]);

  return state;
}
