import type {
  OffscreenProgressMessage,
  BgMessage,
} from '@/lib/transcription/types';
import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';
import { initPortBridge } from '@/lib/background/port-bridge';
import { DB_CHANNEL_NAME } from '@/lib/database/constants';
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
  // Synchronous: register onConnect listener before any connection attempts (MV3 SW requirement)
  initPortBridge(DB_CHANNEL_NAME, ensureOffscreen);

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

  // Ensure Offscreen Document exists on extension lifecycle events.
  // Offscreen hosts PGlite — without it, DB RPC from app.html would queue forever.
  chrome.runtime.onInstalled.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onInstalled: ensureOffscreen failed', err),
    );
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onStartup: ensureOffscreen failed', err),
    );
  });

  console.log('favbase background ready', { id: browser.runtime.id });
});
