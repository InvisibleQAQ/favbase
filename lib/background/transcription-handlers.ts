import type { BackgroundContext } from './types';
import type {
  SubtitleRow,
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
import { settingsStorage } from '@/lib/storage';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
  AsrError,
} from '@/lib/transcription/groq-client';
import {
  fetchAudioBlob,
  AudioExtractError,
} from '@/lib/transcription/audio-extractor';
import { extractBiliAudioUrl } from '@/lib/bilibili/bilibili-api';
import { assertAudioNotReused } from '@/lib/transcription/audio-fingerprint';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import {
  GROQ_MAX_AUDIO_BYTES,
  PROGRESS,
} from '@/lib/transcription/constants';
import {
  getVideoCache,
  mergeVideoCache,
} from '@/lib/cache/video-cache';
import { runTranscriptionPipeline } from '@/lib/transcription/pipeline';

const tabBvids = new Map<number, string>();
const sessionTabMap = new Map<string, number>();

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

export async function handleTranscribe(
  msg: { bvid: string; cid: number; title: string },
  tabId: number,
  ctx: BackgroundContext,
): Promise<TranscribeResponse> {
  const { bvid, cid, title } = msg;

  const controller = new AbortController();
  ctx.tabAbortControllers.set(tabId, controller);
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
      await mergeVideoCache(id, rows, 'groq');
    },
    ensureConnectivity: ensureGroqConnectivity,
    extractAudioUrl: async (bvid: string, cid: number) => {
      try {
        return await extractBiliAudioUrl(bvid, cid);
      } catch (err) {
        throw new AudioExtractError({
          code: 'ASR_NO_AUDIO_SOURCE',
          message: err instanceof Error ? err.message : 'Audio extraction failed',
        });
      }
    },
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
      await ctx.ensureOffscreen();
      const sessionId = `${bvid}_${Date.now()}`;
      sessionTabMap.set(sessionId, tabId);

      try {
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
      } finally {
        sessionTabMap.delete(sessionId);
      }
    },
    processSubtitles,
  };

  try {
    const result = await runTranscriptionPipeline(
      { bvid, cid, title, signal: controller.signal },
      deps,
      (progress, stage, stageParams) => {
        notifyTab(ctx, tabId, bvid, progress, stage, undefined, stageParams);
      },
    );
    if (!result.success) {
      notifyTab(ctx, tabId, bvid, 0, 'failed', result.error);
    }
    return result;
  } finally {
    ctx.tabAbortControllers.delete(tabId);
    tabBvids.delete(tabId);
  }
}

export function handleTranscribeAbort(
  tabId: number | undefined,
  ctx: BackgroundContext,
): Promise<{ success: true }> {
  if (tabId) {
    const ctrl = ctx.tabAbortControllers.get(tabId);
    if (ctrl) ctrl.abort();
  }
  return Promise.resolve({ success: true });
}

export function handleOffscreenProgress(
  msg: OffscreenProgressMessage,
  ctx: BackgroundContext,
): void {
  const range = PROGRESS.CHUNK_TRANSCRIBE_END - PROGRESS.CHUNK_TRANSCRIBE_BEGIN;
  const progress =
    PROGRESS.CHUNK_TRANSCRIBE_BEGIN +
    Math.round((msg.chunkIndex / msg.totalChunks) * range);

  const targetTabId = sessionTabMap.get(msg.sessionId);
  if (targetTabId !== undefined) {
    const bvid = tabBvids.get(targetTabId) ?? '';
    notifyTab(ctx, targetTabId, bvid, progress, 'chunk_transcribing', undefined, {
      current: msg.chunkIndex + 1,
      total: msg.totalChunks,
    });
    return;
  }

  // Defensive fallback: sessionId not found (should not happen in normal flow)
  for (const [tId] of ctx.tabAbortControllers) {
    const bvid = tabBvids.get(tId) ?? '';
    notifyTab(ctx, tId, bvid, progress, 'chunk_transcribing', undefined, {
      current: msg.chunkIndex + 1,
      total: msg.totalChunks,
    });
  }
}
