import type { TranscribeRequest, TranscribeAbort } from '@/lib/transcription/types';
import type { GetVideoCacheRequest, CacheSubtitleRequest } from '@/lib/cache/types';
import type { OffscreenProgressMessage, OffscreenXSyncProgressMessage } from '@/lib/offscreen/types';
import type { XSyncStartMessage } from '@/lib/x/x-messages';

/**
 * Open (or focus) the app.html extension page — content scripts have no
 * `browser.tabs` access, so they delegate navigation to the background SW.
 * `hash` is a hash-router path like `'#/settings'`.
 */
export interface OpenAppPageRequest {
  type: 'OPEN_APP_PAGE';
  hash?: string;
}

export type BgClientMessage =
  | TranscribeRequest
  | TranscribeAbort
  | GetVideoCacheRequest
  | CacheSubtitleRequest
  | OpenAppPageRequest
  | XSyncStartMessage;

export type BgInternalMessage = OffscreenProgressMessage | OffscreenXSyncProgressMessage;

export type BgMessage = BgClientMessage | BgInternalMessage;
