import type { BackgroundContext } from './types';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type {
  TranscribeRequest,
  TranscribeAbort,
  TranscribeResponse,
  TranscribeStage,
  TranscribeStatusPush,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import type {
  OffscreenProgressMessage,
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
} from '@/lib/offscreen/types';
import { getAsrSettings } from '@/lib/storage';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
} from '@/lib/transcription/groq-client';
import { fetchAudioBlob } from '@/lib/transcription/audio-extractor';
import { prepareBiliTranscription } from '@/lib/bilibili/bilibili-transcription-adapter';
import { assertAudioNotReused } from '@/lib/transcription/audio-fingerprint';
import { createErrorInfo } from '@/lib/transcription/types';
import { GROQ_MAX_AUDIO_BYTES, PROGRESS } from '@/lib/transcription/constants';
import { getVideoCache, mergeVideoCache } from '@/lib/cache/video-cache';
import {
  runTranscriptionPipeline,
  type AsrConfig,
  type OnProgress,
} from '@/lib/transcription/pipeline';

type MessageSender = { tab?: { id?: number } };

function notifyTab(
  ctx: BackgroundContext,
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
  ctx.sendToTab(tabId, msg);
}

function createTranscribeAudio(
  tabId: number,
  ctx: BackgroundContext,
  extractAudioUrl: (videoId: string, cid: number) => Promise<string>,
) {
  return async (params: {
    videoId: string;
    cid: number;
    config: AsrConfig;
    signal: AbortSignal;
    title: string;
    onProgress: OnProgress;
  }): Promise<SubtitleRow[]> => {
    const { videoId, cid, config, signal, title, onProgress } = params;

    onProgress(PROGRESS.CONNECTIVITY_CHECK, 'connectivity');
    await ensureGroqConnectivity(config.apiKey, config.baseUrl);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    onProgress(PROGRESS.DOWNLOAD_BEGIN, 'extracting');
    let audioUrl: string;
    try {
      audioUrl = await extractAudioUrl(videoId, cid);
    } catch (err) {
      throw createErrorInfo('ASR_NO_AUDIO_SOURCE', err instanceof Error ? err.message : 'Audio extraction failed');
    }

    onProgress(PROGRESS.DOWNLOAD_BEGIN + 1, 'downloading');
    const audioBlob = await fetchAudioBlob(audioUrl, signal, (p) =>
      onProgress(p, 'downloading'),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    await assertAudioNotReused(audioBlob, videoId);

    if (audioBlob.size <= GROQ_MAX_AUDIO_BYTES) {
      onProgress(PROGRESS.PREPARE_UPLOAD, 'uploading');
      let current: number = PROGRESS.UPLOAD_BEGIN;
      const timer = setInterval(() => {
        if (signal.aborted) return;
        current = Math.min(PROGRESS.UPLOAD_END, current + 2 + Math.random() * 2);
        onProgress(Math.round(current), 'transcribing');
      }, 2000);
      try {
        const result = await requestGroqTranscription(
          audioBlob, config.apiKey, config.model, signal, config.baseUrl,
        );
        return result.rows;
      } finally {
        clearInterval(timer);
      }
    }

    onProgress(PROGRESS.CHUNK_PREPARE, 'chunking');
    await ctx.ensureOffscreen();
    const sessionId = `${videoId}_${Date.now()}`;
    ctx.registerChunkSession(sessionId, tabId);
    try {
      const prepareRes: { success: boolean; error?: TranscribeErrorInfo } =
        await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_CHUNK_PREPARE',
          sessionId,
          audioUrl,
          maxBytes: GROQ_MAX_AUDIO_BYTES,
        } satisfies OffscreenPrepareRequest);

      if (!prepareRes.success) throw prepareRes.error!;

      const transcribeRes: {
        success: boolean;
        rows?: SubtitleRow[];
        error?: TranscribeErrorInfo;
      } = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
        sessionId,
        apiKey: config.apiKey,
        model: config.model,
        title,
        baseUrl: config.baseUrl,
      } satisfies OffscreenTranscribeRequest);

      chrome.runtime
        .sendMessage({ type: 'OFFSCREEN_CHUNK_RELEASE', sessionId })
        .catch(() => {});

      if (!transcribeRes.success) throw transcribeRes.error!;
      return transcribeRes.rows!;
    } finally {
      ctx.unregisterChunkSession(sessionId);
    }
  };
}

export async function handleTranscribe(
  msg: TranscribeRequest,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<TranscribeResponse> {
  const { bvid: videoId, title } = msg;
  const tabId = sender.tab?.id ?? 0;

  const controller = ctx.startTranscription(tabId, videoId);
  if (!controller) {
    return {
      success: false,
      error: createErrorInfo('TRANSCRIBE_DUPLICATE', `Already transcribing ${videoId}`),
    };
  }

  try {
    const platform = await prepareBiliTranscription(videoId, msg.cid);

    const deps = {
      getAsrConfig: getAsrSettings,
      fetchOfficialSubtitle: platform.fetchOfficialSubtitle,
      transcribeAudio: createTranscribeAudio(tabId, ctx, platform.extractAudioUrl),
      cacheGet: async (id: string) => {
        const entry = await getVideoCache(id);
        if (!entry) return null;
        return { rows: entry.rows, source: entry.source };
      },
      cacheSave: async (id: string, rows: SubtitleRow[], source: SubtitleSource) => {
        await mergeVideoCache(id, rows, source);
      },
      postProcess: platform.postProcess,
    };

    const result = await runTranscriptionPipeline(
      { videoId, cid: platform.cid, title, signal: controller.signal,
        officialSourceLabel: 'official', asrSourceLabel: 'asr' },
      deps,
      (progress, stage, stageParams) => {
        notifyTab(ctx, tabId, videoId, progress, stage, undefined, stageParams);
      },
    );
    if (!result.success) {
      notifyTab(ctx, tabId, videoId, 0, 'failed', result.error);
    }
    return result;
  } finally {
    ctx.finishTranscription(tabId);
  }
}

export function handleTranscribeAbort(
  _msg: TranscribeAbort,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<{ success: true }> {
  const tabId = sender.tab?.id;
  if (tabId) ctx.abortTranscription(tabId);
  return Promise.resolve({ success: true });
}

export function handleOffscreenProgress(
  msg: OffscreenProgressMessage,
  _sender: MessageSender,
  ctx: BackgroundContext,
): void {
  const range = PROGRESS.CHUNK_TRANSCRIBE_END - PROGRESS.CHUNK_TRANSCRIBE_BEGIN;
  const progress =
    PROGRESS.CHUNK_TRANSCRIBE_BEGIN +
    Math.round((msg.chunkIndex / msg.totalChunks) * range);
  const stageParams = { current: msg.chunkIndex + 1, total: msg.totalChunks };

  const target = ctx.resolveProgressTarget(msg.sessionId);
  if (!target) {
    console.warn(`[handleOffscreenProgress] unresolved sessionId=${msg.sessionId}, dropping progress`);
    return;
  }
  notifyTab(ctx, target.tabId, target.bvid, progress, 'chunk_transcribing', undefined, stageParams);
}
