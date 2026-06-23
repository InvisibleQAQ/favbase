import type { SubtitleRow } from '@/lib/types';
import type {
  BgMessage,
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeStage,
  TranscribeErrorInfo,
  GetVideoCacheRequest,
  ClearVideoCacheRequest,
  CacheSubtitleRequest,
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
  OffscreenProgressMessage,
} from '@/lib/transcription/types';
import { getBiliAuth } from '@/lib/bilibili/auth';
import { fetchFavFolderList, BiliAuthError } from '@/lib/bilibili/favorites';
import { syncFavFoldersToDb } from '@/lib/bilibili/favorites-sync';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
  AsrError,
} from '@/lib/transcription/groq-client';
import {
  extractAudioUrl,
  fetchAudioBlob,
} from '@/lib/transcription/audio-extractor';
import { assertAudioNotReused } from '@/lib/transcription/audio-fingerprint';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import { settingsStorage } from '@/lib/storage';
import {
  GROQ_MAX_AUDIO_BYTES,
  PROGRESS,
} from '@/lib/transcription/constants';
import {
  getVideoCache,
  mergeVideoCache,
  clearVideoCache,
  initCacheStorageListener,
  computeRowsHash,
  normalizeBvid,
} from '@/lib/cache/video-cache';
import { runTranscriptionPipeline } from '@/lib/transcription/pipeline';

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

  function notifyTab(
    tabId: number,
    bvid: string,
    progress: number,
    stage: TranscribeStage,
    error?: TranscribeErrorInfo,
    stageParams?: Record<string, string | number>,
  ): void {
    const msg: TranscribeStatusPush = {
      type: 'TRANSCRIBE_STATUS',
      bvid,
      progress,
      stage,
      stageParams,
      error,
    };
    browser.tabs.sendMessage(tabId, msg).catch(() => {});
  }

  async function handleTranscribe(
    msg: Extract<BgMessage, { type: 'TRANSCRIBE_AUDIO' }>,
    tabId: number,
  ): Promise<TranscribeResponse> {
    const { bvid, cid, title } = msg;

    const controller = new AbortController();
    tabAbortControllers.set(tabId, controller);
    tabBvids.set(tabId, bvid);

    const deps = {
      getAsrConfig: async () => {
        const s = await settingsStorage.getValue();
        return { apiKey: s.groqApiKey, model: s.groqModel || 'whisper-large-v3-turbo' };
      },
      checkCache: async (id: string) => {
        const entry = await getVideoCache(id);
        if (!entry || entry.rows.length === 0) return null;
        return { rows: entry.rows, source: entry.source };
      },
      saveCache: async (id: string, rows: SubtitleRow[]) => {
        await mergeVideoCache(id, {
          bvid: id,
          rows,
          source: 'groq',
          rawHash: computeRowsHash(rows),
          updatedAt: Date.now(),
        });
      },
      ensureConnectivity: ensureGroqConnectivity,
      extractAudioUrl,
      fetchAudio: fetchAudioBlob,
      checkAudioReuse: assertAudioNotReused,
      transcribeDirect: async (
        blob: Blob, apiKey: string, model: string, signal: AbortSignal,
      ) => {
        const result = await requestGroqTranscription(blob, apiKey, model, signal);
        return result.rows;
      },
      transcribeChunked: async (
        audioUrl: string, apiKey: string, model: string, t: string,
      ) => {
        await ensureOffscreen();
        const sessionId = `${bvid}_${Date.now()}`;

        const prepareRes: { success: boolean; error?: TranscribeErrorInfo } =
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_CHUNK_PREPARE',
            sessionId,
            audioUrl,
            maxBytes: GROQ_MAX_AUDIO_BYTES,
          } satisfies OffscreenPrepareRequest);

        if (!prepareRes.success) throw new AsrError(prepareRes.error!);

        const transcribeRes: {
          success: boolean;
          rows?: SubtitleRow[];
          error?: TranscribeErrorInfo;
        } = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
          sessionId,
          apiKey,
          model,
          title: t,
        } satisfies OffscreenTranscribeRequest);

        chrome.runtime
          .sendMessage({ type: 'OFFSCREEN_CHUNK_RELEASE', sessionId })
          .catch(() => {});

        if (!transcribeRes.success) throw new AsrError(transcribeRes.error!);
        return transcribeRes.rows!;
      },
      processSubtitles,
    };

    try {
      const result = await runTranscriptionPipeline(
        { bvid, cid, title, signal: controller.signal },
        deps,
        (progress, stage, stageParams) => {
          notifyTab(tabId, bvid, progress, stage, undefined, stageParams);
        },
      );
      if (!result.success) {
        notifyTab(tabId, bvid, 0, 'failed', result.error);
      }
      return result;
    } finally {
      tabAbortControllers.delete(tabId);
      tabBvids.delete(tabId);
    }
  }

  browser.runtime.onMessage.addListener(
    (
      msg: OffscreenProgressMessage | BgMessage,
      sender: { tab?: { id?: number } },
    ): void | Promise<unknown> => {
      if (msg.type === 'OFFSCREEN_CHUNK_PROGRESS') {
        const pm = msg as OffscreenProgressMessage;
        const range =
          PROGRESS.CHUNK_TRANSCRIBE_END - PROGRESS.CHUNK_TRANSCRIBE_BEGIN;
        const progress =
          PROGRESS.CHUNK_TRANSCRIBE_BEGIN +
          Math.round((pm.chunkIndex / pm.totalChunks) * range);

        for (const [tId] of tabAbortControllers) {
          const bvid = tabBvids.get(tId) ?? '';
          notifyTab(
            tId,
            bvid,
            progress,
            'chunk_transcribing',
            undefined,
            { current: pm.chunkIndex + 1, total: pm.totalChunks },
          );
        }
        return undefined;
      }

      if (msg.type === 'TRANSCRIBE_ABORT') {
        const tabId = sender.tab?.id;
        if (tabId) {
          const ctrl = tabAbortControllers.get(tabId);
          if (ctrl) ctrl.abort();
        }
        return Promise.resolve({ success: true });
      }

      if (msg.type === 'TRANSCRIBE_AUDIO') {
        const tabId = sender.tab?.id ?? 0;
        return handleTranscribe(msg, tabId);
      }

      if (msg.type === 'GET_VIDEO_CACHE') {
        const tabMsg = msg as GetVideoCacheRequest;
        return getVideoCache(tabMsg.bvid).then((entry) => {
          if (!entry || entry.rows.length === 0) return null;
          return { rows: entry.rows, source: entry.source, cached: true };
        });
      }

      if (msg.type === 'CLEAR_VIDEO_CACHE') {
        const tabMsg = msg as ClearVideoCacheRequest;
        return clearVideoCache(tabMsg.bvid).then(() => ({ success: true }));
      }

      if (msg.type === 'CACHE_SUBTITLE') {
        const tabMsg = msg as CacheSubtitleRequest;
        const bvid = normalizeBvid(tabMsg.bvid);
        const hash = computeRowsHash(tabMsg.rows);
        return mergeVideoCache(bvid, {
          bvid,
          rows: tabMsg.rows,
          source: tabMsg.source,
          rawHash: hash,
          updatedAt: Date.now(),
        })
          .then(() => ({ success: true }))
          .catch((err) => {
            console.warn('[background] CACHE_SUBTITLE failed:', err);
            return { success: false };
          });
      }

      if (msg.type === 'CHECK_BILI_LOGIN') {
        return getBiliAuth().then((auth) => ({
          loggedIn: auth !== null,
          mid: auth?.mid ?? null,
        }));
      }

      if (msg.type === 'FETCH_FAV_FOLDERS') {
        return (async () => {
          const auth = await getBiliAuth();
          if (!auth) {
            return { success: false, error: 'not_logged_in' } as const;
          }
          try {
            const folders = await fetchFavFolderList(auth);
            await ensureOffscreen();
            const { initDbProxy } = await import('@/lib/database/db');
            const db = await initDbProxy(ensureOffscreen);
            const sources = await syncFavFoldersToDb(db, folders);
            return { success: true, data: sources } as const;
          } catch (err) {
            if (err instanceof BiliAuthError) {
              return { success: false, error: 'auth_expired' } as const;
            }
            const detail = err instanceof Error ? err.message : 'unknown';
            console.error('[background] FETCH_FAV_FOLDERS failed:', detail);
            return { success: false, error: detail } as const;
          }
        })();
      }

      return undefined;
    },
  );

  console.log('favbase background ready', { id: browser.runtime.id });
});
