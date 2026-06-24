import { useState, useEffect, useCallback } from 'react';
import { getBiliAuth, fetchFavFolders, BiliAuthError } from '@/lib/bilibili/bilibili-api';
import { syncFavFoldersToDb } from '@/lib/bilibili/favorites-sync';
import { getDb } from '@/lib/database';
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

async function syncFoldersToDb(folders: BiliFavFolder[]): Promise<void> {
  const db = getDb();
  await syncFavFoldersToDb(db, folders);
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
      const auth = await getBiliAuth();
      if (!auth) {
        setLoginState('not_logged_in');
        return;
      }
      setLoginState('logged_in');

      const folderList = await fetchFavFolders(auth);
      setFolders(folderList);
      setLastSyncedAt(new Date());

      // Fire-and-forget: persist folders to PGlite
      if (folderList.length > 0) {
        syncFoldersToDb(folderList).catch((err) =>
          console.error('[fav-folders] DB sync failed:', err),
        );
      }
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
        const auth = await getBiliAuth();
        if (cancelled) return;

        if (!auth) {
          setLoginState('not_logged_in');
          return;
        }
        setLoginState('logged_in');
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
