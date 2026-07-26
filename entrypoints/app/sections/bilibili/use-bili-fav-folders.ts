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
import { startBiliAutoTranscribe } from './auto-transcribe-runtime';

const PLATFORM = 'bilibili';

type LoginState = 'unknown' | 'logged_in' | 'not_logged_in';

/**
 * All folder ids as strings, with the route-selected folder moved to the
 * front — the auto-transcribe continuation drains folders in this order, so
 * the folder the user is looking at transcribes first.
 */
function orderFolderIds(folders: BiliFavFolder[], routeFolderId?: number): string[] {
  const ids = folders.map((f) => String(f.id));
  if (routeFolderId == null) return ids;
  const route = String(routeFolderId);
  if (!ids.includes(route)) return ids;
  return [route, ...ids.filter((id) => id !== route)];
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
      await syncAllFavoriteVideos(
        folderList,
        (progress) => setProgress(progress),
        control,
      );
      if (mountedRef.current) setLastSyncedAt(new Date());
      // Auto-continue the content stage: chain a batch transcription across
      // ALL folders, the one the user is viewing first. Fire-and-forget — the
      // `bilibili:transcribe` job is independent of this sync job, filters out
      // folders without pending videos, and dedupes/gates itself.
      startBiliAutoTranscribe(orderFolderIds(folderList, routeFolderRef.current));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;

    (async () => {
      try {
        const folderList = await fetchAndSyncFolders();
        // Mount continuation (parity with bookmarks): auto-continue any stored
        // pending backlog even when the daily gate already blocked a re-sync.
        // Free in steady state — the runtime dispatches NO job and touches NO
        // network when a local DB query finds no pending videos. Deliberately
        // outside the `cancelled` guard: the job outlives this mount anyway.
        startBiliAutoTranscribe(orderFolderIds(folderList, routeFolderRef.current));
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
