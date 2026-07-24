import { useState, useEffect, useCallback } from 'react';
import {
  fetchAndSyncFolders,
  syncAllFavoriteVideos,
  BiliAuthError,
} from '@/lib/bilibili/bili-sync-service';
import type { BiliFavoritesSyncProgress } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavFoldersReturn {
  folders: BiliFavFolder[];
  loading: boolean;
  syncing: boolean;
  syncProgress: BiliFavoritesSyncProgress | null;
  loginState: LoginState;
  lastSyncedAt: Date | null;
  error: string | null;
  sync: () => Promise<void>;
}

export function useBiliFavFolders(): UseFavFoldersReturn {
  const [folders, setFolders] = useState<BiliFavFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<BiliFavoritesSyncProgress | null>(null);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncProgress(null);
    setError(null);
    try {
      const folderList = await fetchAndSyncFolders();
      setLoginState('logged_in');
      setFolders(folderList);
      await syncAllFavoriteVideos(folderList, setSyncProgress);
      setLastSyncedAt(new Date());
    } catch (err) {
      if (err instanceof BiliAuthError) {
        setLoginState('not_logged_in');
      } else {
        setError(err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
      setSyncProgress(null);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await sync();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to check login');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sync]);

  return {
    folders,
    loading,
    syncing,
    syncProgress,
    loginState,
    lastSyncedAt,
    error,
    sync,
  };
}
