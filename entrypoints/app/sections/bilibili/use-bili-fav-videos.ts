import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFavoriteVideosPage, BiliAuthError } from '@/lib/bilibili/bili-sync-service';
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

export function useBiliFavVideos(mediaId: number, keyword: string = ''): UseFavVideosReturn {
  const [videos, setVideos] = useState<BiliFavVideo[]>([]);
  const [folderTitle, setFolderTitle] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<BiliFavOrder>('mtime');

  // Guards against stale responses (rapid keyword/order/folder changes): only
  // the latest fetch is allowed to write state. Bumped per fetch, captured at
  // call time, re-checked after every await.
  const fetchIdRef = useRef(0);

  const fetchPage = useCallback(async (targetPage: number, targetOrder: BiliFavOrder, targetKeyword: string) => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFavoriteVideosPage(
        mediaId,
        targetPage,
        targetOrder,
        targetKeyword,
      );
      if (fetchId !== fetchIdRef.current) return;
      setLoginState('logged_in');
      setVideos(result.videos);
      setFolderTitle(result.folderTitle);
      setTotalPages(result.totalPages);
      setPage(targetPage);
    } catch (err) {
      if (fetchId !== fetchIdRef.current) return;
      if (err instanceof BiliAuthError) {
        setLoginState('not_logged_in');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch videos');
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [mediaId]);

  // Initial load + refetch from page 1 whenever mediaId, sort order, or the
  // search keyword changes. Stale-response protection lives in fetchPage
  // (fetchIdRef), so no cleanup flag is needed here.
  useEffect(() => {
    fetchPage(1, order, keyword);
  }, [fetchPage, order, keyword]);

  const goToPage = useCallback((p: number) => {
    fetchPage(p, order, keyword);
  }, [fetchPage, order, keyword]);

  const retry = useCallback(() => {
    fetchPage(page, order, keyword);
  }, [fetchPage, page, order, keyword]);

  return { videos, folderTitle, page, totalPages, loading, loginState, error, order, setOrder, goToPage, retry };
}
