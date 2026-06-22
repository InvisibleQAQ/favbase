import { useState, useEffect, useCallback } from 'react';
import type { Source } from '@/lib/database/types';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

interface UseFavFoldersReturn {
  folders: Source[];
  loading: boolean;
  syncing: boolean;
  loginState: LoginState;
  lastSyncedAt: Date | null;
  error: string | null;
  sync: () => Promise<void>;
}

export function useFavFolders(): UseFavFoldersReturn {
  const [folders, setFolders] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkLogin = useCallback(async () => {
    const res = await browser.runtime.sendMessage({ type: 'CHECK_BILI_LOGIN' });
    const state: LoginState = res?.loggedIn ? 'logged_in' : 'not_logged_in';
    setLoginState(state);
    return state;
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await browser.runtime.sendMessage({ type: 'FETCH_FAV_FOLDERS' });
      if (!res.success) {
        if (res.error === 'not_logged_in' || res.error === 'auth_expired') {
          setLoginState('not_logged_in');
          setError(null);
        } else {
          setError(res.error);
        }
        return;
      }
      setLoginState('logged_in');
      setFolders(res.data);
      setLastSyncedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const state = await checkLogin();
        if (cancelled) return;

        if (state === 'logged_in') {
          await sync();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to check login');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [checkLogin, sync]);

  return { folders, loading, syncing, loginState, lastSyncedAt, error, sync };
}
