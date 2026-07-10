import type { BgMessage } from '@/lib/background/messages';
import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';
import { initPortBridge } from '@/lib/background/port-bridge';
import { DB_CHANNEL_NAME } from '@/lib/database/constants';
import { runStorageMigrations } from '@/lib/storage';
import {
  handleTranscribe,
  handleTranscribeAbort,
  handleOffscreenProgress,
} from '@/lib/background/transcription-handlers';
import {
  handleGetVideoCache,
  handleCacheSubtitle,
} from '@/lib/background/cache-handlers';
import { handleOpenAppPage } from '@/lib/background/app-handlers';

function createBackgroundContext(): BackgroundContext {
  const abortControllers = new Map<number, AbortController>();
  const tabVideoIds = new Map<number, string>();
  const activeVideoIds = new Set<string>();
  const sessionTabMap = new Map<string, number>();

  return {
    sendToTab(tabId, message) {
      browser.tabs.sendMessage(tabId, message).catch(() => {});
    },
    ensureOffscreen,

    startTranscription(tabId, videoId) {
      const key = videoId.toLowerCase();
      if (activeVideoIds.has(key)) return null;

      const prevVideoId = tabVideoIds.get(tabId);
      if (prevVideoId) activeVideoIds.delete(prevVideoId.toLowerCase());

      activeVideoIds.add(key);
      const controller = new AbortController();
      abortControllers.set(tabId, controller);
      tabVideoIds.set(tabId, videoId);
      return controller;
    },

    abortTranscription(tabId) {
      const ctrl = abortControllers.get(tabId);
      if (ctrl) ctrl.abort();
      const videoId = tabVideoIds.get(tabId);
      if (videoId) activeVideoIds.delete(videoId.toLowerCase());
      abortControllers.delete(tabId);
      tabVideoIds.delete(tabId);
    },

    finishTranscription(tabId) {
      const videoId = tabVideoIds.get(tabId);
      if (videoId) activeVideoIds.delete(videoId.toLowerCase());
      abortControllers.delete(tabId);
      tabVideoIds.delete(tabId);
    },

    getVideoIdForTab(tabId) {
      return tabVideoIds.get(tabId);
    },

    registerChunkSession(sessionId, tabId) {
      sessionTabMap.set(sessionId, tabId);
    },

    unregisterChunkSession(sessionId) {
      sessionTabMap.delete(sessionId);
    },

    resolveProgressTarget(sessionId) {
      const tabId = sessionTabMap.get(sessionId);
      if (tabId === undefined) return null;
      const videoId = tabVideoIds.get(tabId);
      return { tabId, videoId: videoId ?? '' };
    },
  };
}

export default defineBackground(() => {
  initPortBridge(DB_CHANNEL_NAME, ensureOffscreen);

  initCacheStorageListener();

  const ctx = createBackgroundContext();

  browser.runtime.onMessage.addListener(
    (
      msg: BgMessage,
      sender: { tab?: { id?: number } },
    ): void | Promise<unknown> => {
      switch (msg.type) {
        case 'OFFSCREEN_CHUNK_PROGRESS':
          handleOffscreenProgress(msg, sender, ctx);
          return;
        case 'TRANSCRIBE_ABORT':
          return handleTranscribeAbort(msg, sender, ctx);
        case 'TRANSCRIBE_AUDIO':
          return handleTranscribe(msg, sender, ctx);
        case 'GET_VIDEO_CACHE':
          return handleGetVideoCache(msg);
        case 'CACHE_SUBTITLE':
          return handleCacheSubtitle(msg);
        case 'OPEN_APP_PAGE':
          return handleOpenAppPage(msg);
        default:
          return;
      }
    },
  );

  chrome.runtime.onInstalled.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onInstalled: ensureOffscreen failed', err),
    );
    runStorageMigrations().catch((err) =>
      console.error('[background] onInstalled: storage migration failed', err),
    );
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onStartup: ensureOffscreen failed', err),
    );
    runStorageMigrations().catch((err) =>
      console.error('[background] onStartup: storage migration failed', err),
    );
  });

  console.log('favbase background ready', { id: browser.runtime.id });
});
