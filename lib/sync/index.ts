/**
 * WebDAV sync domain (Phase 1: config sync). Barrel — import from `@/lib/sync`.
 * See CLAUDE.md for architecture, remote layout, and the three-phase roadmap.
 */

export {
  getWebdavConfig,
  setWebdavConfig,
  isConfigSyncable,
  watchWebdavConfig,
} from './sync-config-storage';

export { getSyncStatus, watchSyncStatus } from './sync-meta-storage';

export { doSync, clearRemote } from './sync-engine';

export { initWebdavSyncScheduler } from './scheduler';

export { WebdavClient } from './webdav-client';

export type {
  WebdavConfig,
  WebdavSyncStatus,
  WebdavErrorCode,
  SyncResult,
  WebdavMessage,
  WebdavSyncNowRequest,
  WebdavClearRemoteRequest,
} from './types';
