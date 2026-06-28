import type { BgMessage } from '@/lib/background/messages';
import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';
import { initPortBridge } from '@/lib/background/port-bridge';
import { DB_CHANNEL_NAME } from '@/lib/database/constants';
import { migrateSettingsIfNeeded } from '@/lib/storage';
import {
  handleTranscribe,
  handleTranscribeAbort,
  handleOffscreenProgress,
} from '@/lib/background/transcription-handlers';
import {
  handleGetVideoCache,
  handleCacheSubtitle,
} from '@/lib/background/cache-handlers';

function createBackgroundContext(): BackgroundContext {
  const abortControllers = new Map<number, AbortController>();
  const tabBvids = new Map<number, string>();
  const activeBvids = new Set<string>();
  const sessionTabMap = new Map<string, number>();

  return {
    sendToTab(tabId, message) {
      browser.tabs.sendMessage(tabId, message).catch(() => {});
    },
    ensureOffscreen,

    startTranscription(tabId, bvid) {
      const key = bvid.toLowerCase();
      if (activeBvids.has(key)) return null;

      // Clean up any stale transcription for this tab (e.g. previous request didn't finish)
      const prevBvid = tabBvids.get(tabId);
      if (prevBvid) activeBvids.delete(prevBvid.toLowerCase());

      activeBvids.add(key);
      const controller = new AbortController();
      abortControllers.set(tabId, controller);
      tabBvids.set(tabId, bvid);
      return controller;
    },

    abortTranscription(tabId) {
      const ctrl = abortControllers.get(tabId);
      if (ctrl) ctrl.abort();
      const bvid = tabBvids.get(tabId);
      if (bvid) activeBvids.delete(bvid.toLowerCase());
      abortControllers.delete(tabId);
      tabBvids.delete(tabId);
    },

    finishTranscription(tabId) {
      const bvid = tabBvids.get(tabId);
      if (bvid) activeBvids.delete(bvid.toLowerCase());
      abortControllers.delete(tabId);
      tabBvids.delete(tabId);
    },

    getBvidForTab(tabId) {
      return tabBvids.get(tabId);
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
      const bvid = tabBvids.get(tabId);
      return { tabId, bvid: bvid ?? '' };
    },

    getActiveTranscriptions() {
      const result: Array<{ tabId: number; bvid: string }> = [];
      for (const [tabId, bvid] of tabBvids) {
        result.push({ tabId, bvid });
      }
      return result;
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
        default:
          return;
      }
    },
  );

  chrome.runtime.onInstalled.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onInstalled: ensureOffscreen failed', err),
    );
    migrateSettingsIfNeeded().catch((err) =>
      console.error('[background] onInstalled: settings migration failed', err),
    );
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onStartup: ensureOffscreen failed', err),
    );
    migrateSettingsIfNeeded().catch((err) =>
      console.error('[background] onStartup: settings migration failed', err),
    );
  });

  console.log('favbase background ready', { id: browser.runtime.id });
});
