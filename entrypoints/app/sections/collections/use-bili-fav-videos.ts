import { useState, useEffect, useCallback } from 'react';
import { getBiliAuth, fetchFavVideos, BiliAuthError } from '@/lib/bilibili/bilibili-api';
import { syncFavVideosToDb } from '@/lib/bilibili/videos-sync';
import { getDb } from '@/lib/database';
import { sources } from '@/lib/database/entities/sources';
import { eq, and } from 'drizzle-orm';
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

const PAGE_SIZE = 20;

async function syncVideosToDb(videos: BiliFavVideo[], mediaId: number): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.platform, 'bilibili'),
        eq(sources.platformSourceId, String(mediaId)),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    console.warn('[fav-videos] Source not found for mediaId=%d, skipping DB sync', mediaId);
    return;
  }

  await syncFavVideosToDb(db, videos, existing[0].id);
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
      const auth = await getBiliAuth();
      if (!auth) {
        setLoginState('not_logged_in');
        return;
      }
      setLoginState('logged_in');

      const data = await fetchFavVideos(auth, mediaId, targetPage);
      const medias = data.medias ?? [];
      setVideos(medias);
      setFolderTitle(data.info.title);
      setTotalPages(Math.max(1, Math.ceil(data.info.media_count / PAGE_SIZE)));
      setPage(targetPage);

      // Fire-and-forget: persist to PGlite
      if (medias.length > 0) {
        syncVideosToDb(medias, mediaId).catch((err) => {
          console.error('[fav-videos] DB sync failed:', err);
          if (err?.cause) console.error('[fav-videos] Cause:', err.cause);
        });
      }
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
