import type { SubtitleRow } from '@/lib/types';
import type {
  BgMessage,
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeErrorInfo,
  GetVideoCacheRequest,
  ClearVideoCacheRequest,
  CacheSubtitleRequest,
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
  OffscreenProgressMessage,
} from '@/lib/transcription/types';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
  AsrError,
} from '@/lib/transcription/groq-client';
import {
  extractAudioUrl,
  fetchAudioBlob,
  AudioExtractError,
} from '@/lib/transcription/audio-extractor';
import {
  assertAudioNotReused,
  AudioReuseError,
} from '@/lib/transcription/audio-fingerprint';
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
} from '@/lib/cache/video-cache';

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
    stage: string,
    error?: TranscribeErrorInfo,
  ): void {
    const msg: TranscribeStatusPush = {
      type: 'TRANSCRIBE_STATUS',
      bvid,
      progress,
      stage,
      error,
    };
    browser.tabs.sendMessage(tabId, msg).catch(() => {});
  }

  function toErrorInfo(err: unknown): TranscribeErrorInfo {
    if (err instanceof AsrError) return err.info;
    if (err instanceof AudioExtractError) return err.info;
    if (err instanceof AudioReuseError) return err.info;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { code: 'ASR_REQUEST_TIMEOUT', message: '操作已取消' };
    }
    return {
      code: 'ASR_UNKNOWN',
      message: err instanceof Error ? err.message : '未知错误',
    };
  }

  function startFakeProgress(
    tabId: number,
    bvid: string,
    from: number,
    to: number,
    signal: AbortSignal,
  ): ReturnType<typeof setInterval> {
    let current = from;
    return setInterval(() => {
      if (signal.aborted) return;
      const increment = 2 + Math.random() * 2;
      current = Math.min(to, current + increment);
      notifyTab(tabId, bvid, Math.round(current), '转录中');
    }, 2000);
  }

  async function handleTranscribe(
    msg: Extract<BgMessage, { type: 'TRANSCRIBE_AUDIO' }>,
    tabId: number,
  ): Promise<TranscribeResponse> {
    const { bvid, cid, title } = msg;

    const cached = await getVideoCache(bvid);
    if (cached && cached.rows.length > 0) {
      return {
        success: true,
        data: { rows: cached.rows, source: cached.source, cached: true },
      };
    }

    const settings = await settingsStorage.getValue();
    const apiKey = settings.groqApiKey;
    const model = settings.groqModel || 'whisper-large-v3-turbo';

    if (!apiKey) {
      return {
        success: false,
        error: {
          code: 'ASR_INVALID_KEY',
          message: '请先在设置中配置 Groq API Key',
        },
      };
    }

    const controller = new AbortController();
    tabAbortControllers.set(tabId, controller);
    tabBvids.set(tabId, bvid);

    try {
      notifyTab(tabId, bvid, PROGRESS.START, '开始转录');

      notifyTab(tabId, bvid, PROGRESS.CONNECTIVITY_CHECK, '检查 Groq 连通性');
      await ensureGroqConnectivity(apiKey);

      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');

      notifyTab(tabId, bvid, PROGRESS.DOWNLOAD_BEGIN, '提取音频地址');
      const audioUrl = await extractAudioUrl(bvid, cid);

      notifyTab(tabId, bvid, PROGRESS.DOWNLOAD_BEGIN + 1, '下载音频');
      const audioBlob = await fetchAudioBlob(
        audioUrl,
        controller.signal,
        (p) => notifyTab(tabId, bvid, p, '下载音频'),
      );

      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');

      await assertAudioNotReused(audioBlob, bvid);

      let rows: SubtitleRow[];

      if (audioBlob.size <= GROQ_MAX_AUDIO_BYTES) {
        notifyTab(tabId, bvid, PROGRESS.PREPARE_UPLOAD, '上传音频到 Groq');

        const fakeTimer = startFakeProgress(
          tabId,
          bvid,
          PROGRESS.UPLOAD_BEGIN,
          PROGRESS.UPLOAD_END,
          controller.signal,
        );

        try {
          const result = await requestGroqTranscription(
            audioBlob,
            apiKey,
            model,
            controller.signal,
          );
          rows = result.rows;
        } finally {
          clearInterval(fakeTimer);
        }
      } else {
        notifyTab(tabId, bvid, PROGRESS.CHUNK_PREPARE, '准备分块（FFmpeg）');

        await ensureOffscreen();
        const sessionId = `${bvid}_${Date.now()}`;

        const prepareRes: { success: boolean; error?: TranscribeErrorInfo } =
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_CHUNK_PREPARE',
            sessionId,
            audioBytes: await audioBlob.arrayBuffer(),
            maxBytes: GROQ_MAX_AUDIO_BYTES,
          } satisfies OffscreenPrepareRequest);

        if (!prepareRes.success) {
          throw new AsrError(prepareRes.error!);
        }

        const transcribeRes: {
          success: boolean;
          rows?: SubtitleRow[];
          error?: TranscribeErrorInfo;
        } = await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
          sessionId,
          apiKey,
          model,
          title,
        } satisfies OffscreenTranscribeRequest);

        chrome.runtime
          .sendMessage({ type: 'OFFSCREEN_CHUNK_RELEASE', sessionId })
          .catch(() => {});

        if (!transcribeRes.success) {
          throw new AsrError(transcribeRes.error!);
        }

        rows = transcribeRes.rows!;
      }

      notifyTab(tabId, bvid, PROGRESS.PARSING, '处理字幕');
      rows = processSubtitles(rows);

      await mergeVideoCache(bvid, {
        bvid,
        rows,
        source: 'groq',
        rawHash: computeRowsHash(rows),
        updatedAt: Date.now(),
      });
      notifyTab(tabId, bvid, PROGRESS.DONE, '转录完成');

      return {
        success: true,
        data: { rows, source: 'groq', cached: false },
      };
    } catch (err) {
      const errorInfo = toErrorInfo(err);
      notifyTab(tabId, bvid, 0, '转录失败', errorInfo);
      return { success: false, error: errorInfo };
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
            `分块转录 ${pm.chunkIndex + 1}/${pm.totalChunks}`,
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
        const hash = computeRowsHash(tabMsg.rows);
        return mergeVideoCache(tabMsg.bvid, {
          bvid: tabMsg.bvid,
          rows: tabMsg.rows,
          source: tabMsg.source,
          rawHash: hash,
          updatedAt: Date.now(),
        }).then(() => ({ success: true }));
      }

      return undefined;
    },
  );

  console.log('favbase background ready', { id: browser.runtime.id });
});
