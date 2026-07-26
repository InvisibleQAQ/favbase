import { doSync, clearRemote } from '@/lib/sync';
import type { WebdavSyncNowRequest, WebdavClearRemoteRequest, SyncResult } from '@/lib/sync';

/** UI "Sync now" → run a full sync in the SW (owns the engine + host grant). */
export function handleWebdavSyncNow(_msg: WebdavSyncNowRequest): Promise<SyncResult> {
  return doSync();
}

/** UI "Clear remote data" escape hatch → delete the remote /FavbaseSync tree. */
export function handleWebdavClearRemote(_msg: WebdavClearRemoteRequest): Promise<SyncResult> {
  return clearRemote();
}
