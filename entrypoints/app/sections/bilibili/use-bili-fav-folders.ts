import { useState, useEffect, useCallback } from 'react';
import { fetchAndSyncFolders, BiliAuthError } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavFoldersReturn {
  folders: BiliFavFolder[];
  loading: boolean;
  syncing: boolean;
  loginState: LoginState;
  lastSyncedAt: Date | null;
  error: string | null;
  sync: () => Promise<void>;
}

export function useBiliFavFolders(): UseFavFoldersReturn {
  const [folders, setFolders] = useState<BiliFavFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const folderList = await fetchAndSyncFolders();
      setLoginState('logged_in');
      setFolders(folderList);
      setLastSyncedAt(new Date());
    } catch (err) {
      if (err instanceof BiliAuthError) {
        setLoginState('not_logged_in');
      } else {
        setError(err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
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

  return { folders, loading, syncing, loginState, lastSyncedAt, error, sync };
}
