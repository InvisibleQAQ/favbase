import type {
  TranscribeStatusPush,
  OffscreenProgressMessage,
  BgMessage,
} from '@/lib/transcription/types';
import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
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
  const tabBvids = new Map<number, string>();

  async function ensureOffscreen(): Promise<void> {
    const exists = await chrome.offscreen.hasDocument();
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('/offscreen.html'),
        reasons: ['WORKERS'],
        justification: 'FFmpeg WASM audio chunking for ASR transcription',
      });
    }
  }

  const ctx: BackgroundContext = {
    tabAbortControllers,
    tabBvids,
    notifyTab(tabId, bvid, progress, stage, error, stageParams) {
      const msg: TranscribeStatusPush = {
        type: 'TRANSCRIBE_STATUS',
        bvid,
        progress,
        stage,
        stageParams,
        error,
      };
      browser.tabs.sendMessage(tabId, msg).catch(() => {});
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
