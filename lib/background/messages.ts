import type { TranscribeRequest, TranscribeAbort } from '@/lib/transcription/types';
import type { GetVideoCacheRequest, CacheSubtitleRequest } from '@/lib/cache/types';
import type { OffscreenProgressMessage } from '@/lib/offscreen/types';

export type BgClientMessage =
  | TranscribeRequest
  | TranscribeAbort
  | GetVideoCacheRequest
  | CacheSubtitleRequest;

export type BgInternalMessage = OffscreenProgressMessage;

export type BgMessage = BgClientMessage | BgInternalMessage;
