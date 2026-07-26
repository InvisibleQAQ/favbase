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
import {
  handleSummarize,
  handleSummarizeAbort,
  handleGetSummaryCache,
} from '@/lib/background/summary-handlers';
import { createJobRegistry } from '@/lib/background/job-registry';
import { handleOpenAppPage } from '@/lib/background/app-handlers';
import { handleFetchBookmarkPage } from '@/lib/background/bookmark-handlers';
import { handleWebdavSyncNow, handleWebdavClearRemote } from '@/lib/background/sync-handlers';
import { initWebdavSyncScheduler } from '@/lib/sync';
import { captureXTokens } from '@/lib/x/x-auth';

function createBackgroundContext(): BackgroundContext {
  const transcription = createJobRegistry();
  const summary = createJobRegistry();
  const sessionTabMap = new Map<string, number>();

  return {
    sendToTab(tabId, message) {
      browser.tabs.sendMessage(tabId, message).catch(() => {});
    },
    ensureOffscreen,

    startTranscription: transcription.start,
    abortTranscription: transcription.abort,
    finishTranscription: transcription.finish,
    getVideoIdForTab: transcription.getVideoId,

    startSummary: summary.start,
    abortSummary: summary.abort,
    finishSummary: summary.finish,

    registerChunkSession(sessionId, tabId) {
      sessionTabMap.set(sessionId, tabId);
    },

    unregisterChunkSession(sessionId) {
      sessionTabMap.delete(sessionId);
    },

    resolveProgressTarget(sessionId) {
      const tabId = sessionTabMap.get(sessionId);
      if (tabId === undefined) return null;
      return { tabId, videoId: transcription.getVideoId(tabId) ?? '' };
    },
  };
}

export default defineBackground(() => {
  initPortBridge(DB_CHANNEL_NAME, ensureOffscreen);

  initCacheStorageListener();

  // WebDAV sync scheduler: alarms + settings/locale watch + startup catch-up.
  // Registers its listeners synchronously so the SW can be woken by them.
  initWebdavSyncScheduler();

  // Capture X (Twitter) auth headers from the logged-in web client's own
  // requests (observational webRequest — returns nothing). x-api.ts replays
  // them verbatim to read bookmarks; see lib/x/x-auth.ts. host_permission for
  // x.com is required for the headers to be visible.
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      captureXTokens(details)
        .then((captured) => {
          // One log per (deduped) token set — diagnoses "no-token" sync errors:
          // if this never appears, the capture chain itself is broken.
          if (captured) console.log('[favbase x-auth] captured X session headers');
        })
        .catch((err) => console.warn('[favbase x-auth] token capture failed:', err));
      return undefined;
    },
    { urls: ['*://x.com/*'] },
    ['requestHeaders', 'extraHeaders'],
  );

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
        case 'SUMMARIZE_VIDEO':
          return handleSummarize(msg, sender, ctx);
        case 'SUMMARIZE_ABORT':
          return handleSummarizeAbort(msg, sender, ctx);
        case 'GET_SUMMARY_CACHE':
          return handleGetSummaryCache(msg);
        case 'OPEN_APP_PAGE':
          return handleOpenAppPage(msg);
        case 'FETCH_BOOKMARK_PAGE':
          return handleFetchBookmarkPage(msg);
        case 'WEBDAV_SYNC_NOW':
          return handleWebdavSyncNow(msg);
        case 'WEBDAV_CLEAR_REMOTE':
          return handleWebdavClearRemote(msg);
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
