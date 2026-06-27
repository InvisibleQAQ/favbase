import { useState, useEffect, useCallback } from 'react';
import { fetchAndSyncVideos, BiliAuthError } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavVideo } from '@/lib/bilibili/types';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavVideosReturn {
  videos: BiliFavVideo[];
  folderTitle: string;
  page: number;
  totalPages: number;
  loading: boolean;
  loginState: LoginState;
  error: string | null;
  goToPage: (p: number) => void;
  retry: () => void;
}

export function useBiliFavVideos(mediaId: number): UseFavVideosReturn {
  const [videos, setVideos] = useState<BiliFavVideo[]>([]);
  const [folderTitle, setFolderTitle] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAndSyncVideos(mediaId, targetPage);
      setLoginState('logged_in');
      setVideos(result.videos);
      setFolderTitle(result.folderTitle);
      setTotalPages(result.totalPages);
      setPage(targetPage);
    } catch (err) {
      if (err instanceof BiliAuthError) {
        setLoginState('not_logged_in');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch videos');
      }
    } finally {
      setLoading(false);
    }
  }, [mediaId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await fetchPage(1);
      if (cancelled) return;
    })();

    return () => { cancelled = true; };
  }, [fetchPage]);

  const goToPage = useCallback((p: number) => {
    fetchPage(p);
  }, [fetchPage]);

  const retry = useCallback(() => {
    fetchPage(page);
  }, [fetchPage, page]);

  return { videos, folderTitle, page, totalPages, loading, loginState, error, goToPage, retry };
}
