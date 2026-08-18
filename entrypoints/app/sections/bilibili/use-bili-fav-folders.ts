import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAndSyncFolders,
  BiliAuthError,
} from '@/lib/bilibili/bili-sync-service';
import type { BiliFavoritesSyncProgress } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';
import {
  startJob,
  useJob,
  type BackgroundJob,
} from '../../hooks/background-jobs-store';
import { runBilibiliSync } from './bilibili-sync-adapter';

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

export function useBiliFavFolders(routeFolderId?: number): UseFavFoldersReturn {
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

  // Latest route selection for the post-sync transcription chain. The runner
  // outlives unmounts, so it reads the ref (last known selection) and falls
  // back to the default (first) folder.
  const routeFolderRef = useRef<number | undefined>(routeFolderId);
  useEffect(() => {
    routeFolderRef.current = routeFolderId;
  }, [routeFolderId]);

  const sync = useCallback(async () => {
    setLoadError(null);
    startJob(PLATFORM, 'sync', async (setProgress, control) => {
      // The shared Sync Adapter: folder sync, the streaming Fetch→Transcript
      // runtime and the backlog embed dispatch all live there — the daily
      // auto-sync coordinator runs the exact same function. Only the manual
      // trigger's Fetch-producer priority and UI mirroring are added here.
      await runBilibiliSync(setProgress, control, {
        preferFolderId: routeFolderRef.current,
        onFolders: (folderList) => {
          if (mountedRef.current) {
            setLoginState('logged_in');
            setFolders(folderList);
          }
        },
      });
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
