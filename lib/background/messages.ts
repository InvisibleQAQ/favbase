import type { TranscribeRequest, TranscribeAbort } from '@/lib/transcription/types';
import type { GetVideoCacheRequest, CacheSubtitleRequest } from '@/lib/cache/types';
import type { OffscreenProgressMessage } from '@/lib/offscreen/types';

/**
 * Open (or focus) the app.html extension page — content scripts have no
 * `browser.tabs` access, so they delegate navigation to the background SW.
 * `hash` is a hash-router path like `'#/settings'`.
 */
export interface OpenAppPageRequest {
  type: 'OPEN_APP_PAGE';
  hash?: string;
}

export interface FetchBookmarkPageRequest {
  type: 'FETCH_BOOKMARK_PAGE';
  url: string;
}

export type BgClientMessage =
  | TranscribeRequest
  | TranscribeAbort
  | GetVideoCacheRequest
  | CacheSubtitleRequest
  | FetchBookmarkPageRequest
  | OpenAppPageRequest;

export type BgInternalMessage = OffscreenProgressMessage;

export type BgMessage = BgClientMessage | BgInternalMessage;
