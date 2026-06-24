import type { BackgroundContext } from './types';
import type { SubtitleRow } from '@/lib/types';
import type {
  TranscribeResponse,
  OffscreenProgressMessage,
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
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

export async function handleTranscribe(
  msg: { bvid: string; cid: number; title: string },
  tabId: number,
  ctx: BackgroundContext,
): Promise<TranscribeResponse> {
  const { bvid, cid, title } = msg;

  const controller = new AbortController();
  ctx.tabAbortControllers.set(tabId, controller);
  ctx.tabBvids.set(tabId, bvid);

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
        ctx.notifyTab(tabId, bvid, progress, stage, undefined, stageParams);
      },
    );
    if (!result.success) {
      ctx.notifyTab(tabId, bvid, 0, 'failed', result.error);
    }
    return result;
  } finally {
    ctx.tabAbortControllers.delete(tabId);
    ctx.tabBvids.delete(tabId);
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

  for (const [tId] of ctx.tabAbortControllers) {
    const bvid = ctx.tabBvids.get(tId) ?? '';
    ctx.notifyTab(tId, bvid, progress, 'chunk_transcribing', undefined, {
      current: msg.chunkIndex + 1,
      total: msg.totalChunks,
    });
  }
}
