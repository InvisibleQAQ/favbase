import { useState, useEffect, useCallback } from 'react';
import { fetchAndSyncVideos, BiliAuthError } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavOrder, BiliFavVideo } from '@/lib/bilibili/types';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavVideosReturn {
  videos: BiliFavVideo[];
  folderTitle: string;
  page: number;
  totalPages: number;
  loading: boolean;
  loginState: LoginState;
  error: string | null;
  order: BiliFavOrder;
  setOrder: (o: BiliFavOrder) => void;
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
  const [order, setOrder] = useState<BiliFavOrder>('mtime');

  const fetchPage = useCallback(async (targetPage: number, targetOrder: BiliFavOrder) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAndSyncVideos(mediaId, targetPage, targetOrder);
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

  // Initial load + refetch from page 1 whenever mediaId or sort order changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await fetchPage(1, order);
      if (cancelled) return;
    })();

    return () => { cancelled = true; };
  }, [fetchPage, order]);

  const goToPage = useCallback((p: number) => {
    fetchPage(p, order);
  }, [fetchPage, order]);

  const retry = useCallback(() => {
    fetchPage(page, order);
  }, [fetchPage, page, order]);

  return { videos, folderTitle, page, totalPages, loading, loginState, error, order, setOrder, goToPage, retry };
}
