import type {
  OffscreenProgressMessage,
  BgMessage,
} from '@/lib/transcription/types';
import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';
import {
  handleTranscribe,
  handleTranscribeAbort,
  handleOffscreenProgress,
} from '@/lib/background/transcription-handlers';
import {
  handleGetVideoCache,
  handleCacheSubtitle,
} from '@/lib/background/cache-handlers';

export default defineBackground(() => {
  initCacheStorageListener();

  const tabAbortControllers = new Map<number, AbortController>();

  const ctx: BackgroundContext = {
    tabAbortControllers,
    sendToTab(tabId, message) {
      browser.tabs.sendMessage(tabId, message).catch(() => {});
    },
    ensureOffscreen,
  };

  browser.runtime.onMessage.addListener(
    (
      msg: OffscreenProgressMessage | BgMessage,
      sender: { tab?: { id?: number } },
    ): void | Promise<unknown> => {
      switch (msg.type) {
        case 'OFFSCREEN_CHUNK_PROGRESS':
          handleOffscreenProgress(msg as OffscreenProgressMessage, ctx);
          return;
        case 'TRANSCRIBE_ABORT':
          return handleTranscribeAbort(sender.tab?.id, ctx);
        case 'TRANSCRIBE_AUDIO':
          return handleTranscribe(msg, sender.tab?.id ?? 0, ctx);
        case 'GET_VIDEO_CACHE':
          return handleGetVideoCache(msg);
        case 'CACHE_SUBTITLE':
          return handleCacheSubtitle(msg);
        default:
          return;
      }
    },
  );

  console.log('favbase background ready', { id: browser.runtime.id });
});
