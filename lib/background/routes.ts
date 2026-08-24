import type { BgMessage } from './messages';
import type { BackgroundContext } from './types';
import type { BackgroundMessageSender } from './dispatcher';
import {
  handleTranscribe,
  handleTranscribeAbort,
  handleOffscreenProgress,
} from './transcription-handlers';
import { handleGetVideoCache, handleCacheSubtitle } from './cache-handlers';
import {
  handleSummarize,
  handleSummarizeAbort,
  handleGetSummaryCache,
} from './summary-handlers';
import { handleOpenAppPage } from './app-handlers';
import { handleFetchBookmarkPage } from './bookmark-handlers';
import { handleWebdavSyncNow, handleWebdavClearRemote } from './sync-handlers';
import { handleAgentBridgeConnectNow } from './agent-bridge-handlers';

export function routeBackgroundMessage(
  message: BgMessage,
  sender: BackgroundMessageSender,
  ctx: BackgroundContext,
): void | Promise<unknown> {
  switch (message.type) {
    case 'OFFSCREEN_CHUNK_PROGRESS':
      handleOffscreenProgress(message, sender, ctx);
      return;
    case 'TRANSCRIBE_ABORT':
      return handleTranscribeAbort(message, sender, ctx);
    case 'TRANSCRIBE_AUDIO':
      return handleTranscribe(message, sender, ctx);
    case 'GET_VIDEO_CACHE':
      return handleGetVideoCache(message);
    case 'CACHE_SUBTITLE':
      return handleCacheSubtitle(message);
    case 'SUMMARIZE_VIDEO':
      return handleSummarize(message, sender, ctx);
    case 'SUMMARIZE_ABORT':
      return handleSummarizeAbort(message, sender, ctx);
    case 'GET_SUMMARY_CACHE':
      return handleGetSummaryCache(message);
    case 'OPEN_APP_PAGE':
      return handleOpenAppPage(message);
    case 'FETCH_BOOKMARK_PAGE':
      return handleFetchBookmarkPage(message);
    case 'AGENT_BRIDGE_CONNECT_NOW':
      return handleAgentBridgeConnectNow(message, ctx);
    case 'WEBDAV_SYNC_NOW':
      return handleWebdavSyncNow(message);
    case 'WEBDAV_CLEAR_REMOTE':
      return handleWebdavClearRemote(message);
  }

  return assertNever(message);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled background message type: ${String(value)}`);
}
