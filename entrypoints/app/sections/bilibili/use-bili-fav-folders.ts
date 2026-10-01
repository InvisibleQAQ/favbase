import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchAndSyncFolders } from '@/lib/bilibili/bili-sync-service';
import { initDbProxy } from '@/lib/database';
import { getPlatformLastSyncedAt } from '@/lib/database/collection-queries';
import type { BiliFavoritesSyncProgress } from '@/lib/bilibili/bili-sync-service';
import type { BiliFavFolder } from '@/lib/bilibili/types';
import {
  startJob,
  useJob,
  type BackgroundJob,
} from '../../hooks/background-jobs-store';
import {
  classifyCollectionSyncError,
  type CollectionSyncError,
} from '../../hooks/collection-sync-error';
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
  /** The sync error if there is one, else the mount-time folder load error. Auth never lands here — it is `loginState`. */
  error: CollectionSyncError | null;
  syncJob: BackgroundJob<BiliFavoritesSyncProgress> | null;
  sync: () => Promise<void>;
}

export function useBiliFavFolders(routeFolderId?: number): UseFavFoldersReturn {
  const [folders, setFolders] = useState<BiliFavFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<LoginState>('unknown');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<CollectionSyncError | null>(null);
  const mountedRef = useRef(true);
  const syncJob = useJob<BiliFavoritesSyncProgress>(PLATFORM, 'sync');
  const syncing = syncJob?.running ?? false;
  const syncProgress = syncJob?.progress ?? null;
  const classifiedSyncError = useMemo(
    () => (syncJob?.error != null ? classifyCollectionSyncError(syncJob.error) : null),
    [syncJob?.error],
  );
  const syncAuthFailed = classifiedSyncError?.kind === 'auth';
  const syncError = syncAuthFailed ? null : classifiedSyncError;
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
    });
  }, []);

  // "Last synced" = the latest successful Platform Sync in the record, so it
  // survives a reload. The mount-time folder fetch below is not a Platform
  // Sync and never moves it. Re-read when the sync job's generation moves
  // (success only), including a daily auto-sync that finished elsewhere.
  const syncGeneration = syncJob?.generation ?? 0;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const syncedAt = await getPlatformLastSyncedAt(PLATFORM, await initDbProxy());
      if (!cancelled) setLastSyncedAt(syncedAt);
    })().catch((err) => console.error('[bilibili] last-synced load failed:', err));
    return () => {
      cancelled = true;
    };
  }, [syncGeneration]);

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
          const classified = classifyCollectionSyncError(err);
          if (classified.kind === 'auth') {
            setLoginState('not_logged_in');
          } else {
            setLoadError(classified);
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
