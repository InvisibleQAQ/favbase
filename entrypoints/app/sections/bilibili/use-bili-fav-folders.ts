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
import { runBiliStreamingSync } from './auto-transcribe-runtime';

const PLATFORM = 'bilibili';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

/**
 * Move the route-selected Source to the front of the Fetch producer. The
 * Transcript inbox inherits this order from persisted page notifications.
 */
function orderFolders(folders: BiliFavFolder[], routeFolderId?: number): BiliFavFolder[] {
  if (routeFolderId == null) return folders;
  const selected = folders.find((folder) => folder.id === routeFolderId);
  if (!selected) return folders;
  return [selected, ...folders.filter((folder) => folder.id !== routeFolderId)];
}

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
      await runBiliStreamingSync(
        orderFolders(folderList, routeFolderRef.current),
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
