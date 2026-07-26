import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAndSyncFolders,
  syncAllFavoriteVideos,
  BiliAuthError,
} from '@/lib/bilibili/bili-sync-service';
import type { BiliFavoritesSyncProgress } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';
import {
  startJob,
  useJob,
  type BackgroundJob,
} from '../../hooks/background-jobs-store';

const PLATFORM = 'bilibili';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavFoldersReturn {
  folders: BiliFavFolder[];
  loading: boolean;
  syncing: boolean;
  syncProgress: BiliFavoritesSyncProgress | null;
  loginState: LoginState;
  lastSyncedAt: Date | null;
  error: string | null;
  syncJob: BackgroundJob<BiliFavoritesSyncProgress> | null;
  sync: () => Promise<void>;
}

export function useBiliFavFolders(): UseFavFoldersReturn {
  const [folders, setFolders] = useState<BiliFavFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const syncJob = useJob<BiliFavoritesSyncProgress>(PLATFORM, 'sync');
  const syncing = syncJob?.running ?? false;
  const syncProgress = syncJob?.progress ?? null;
  const syncAuthFailed = syncJob?.error instanceof BiliAuthError;
  const syncError = syncJob?.error != null && !syncAuthFailed
    ? syncJob.error instanceof Error
      ? syncJob.error.message
      : 'Sync failed'
    : null;
  const effectiveLoginState = syncAuthFailed ? 'not_logged_in' : loginState;
  const error = syncError ?? loadError;

  const sync = useCallback(async () => {
    setLoadError(null);
    startJob(PLATFORM, 'sync', async (setProgress, control) => {
      setProgress({
        fetchedCount: 0,
        folderIndex: 0,
        folderCount: 0,
        folderTitle: '',
        page: 0,
        totalPages: 0,
      });
      const folderList = await fetchAndSyncFolders(control);
      if (mountedRef.current) {
        setLoginState('logged_in');
        setFolders(folderList);
      }
      await syncAllFavoriteVideos(
        folderList,
        (progress) => setProgress(progress),
        control,
      );
      if (mountedRef.current) setLastSyncedAt(new Date());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;

    (async () => {
      try {
        const folderList = await fetchAndSyncFolders();
        if (cancelled) return;
        setLoginState('logged_in');
        setFolders(folderList);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof BiliAuthError) {
            setLoginState('not_logged_in');
          } else {
            setLoadError(err instanceof Error ? err.message : 'Failed to check login');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  return {
    folders,
    loading,
    syncing,
    syncProgress,
    loginState: effectiveLoginState,
    lastSyncedAt,
    error,
    syncJob,
    sync,
  };
}
