import type { BackgroundContext } from './types';
import type {
  SubtitleRow,
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
import { settingsStorage, resolveAsrConfig } from '@/lib/storage';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
} from '@/lib/transcription/groq-client';
import { fetchAudioBlob } from '@/lib/transcription/audio-extractor';
import {
  extractBiliAudioUrl,
  getBiliAuth,
  fetchCidByPageList,
  fetchSubtitle,
} from '@/lib/bilibili/bilibili-api';
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

const SUBTITLE_RETRY_DELAYS = [1000, 2000];

function createFetchOfficialSubtitle(auth: Awaited<ReturnType<typeof getBiliAuth>>) {
  return async (bvid: string, cid: number): Promise<SubtitleRow[] | null> => {
    for (let attempt = 0; attempt <= SUBTITLE_RETRY_DELAYS.length; attempt++) {
      try {
        const result = await fetchSubtitle(bvid, cid, auth ?? undefined);
        if (result.status === 'ok' && result.rows.length > 0) return result.rows;
        if (result.status === 'no_subtitle') return null;
        if (attempt < SUBTITLE_RETRY_DELAYS.length) {
          console.warn(
            `[handleTranscribe] Official subtitle error for ${bvid} (attempt ${attempt + 1}): ${result.error ?? 'unknown'} — retrying`,
          );
          await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_DELAYS[attempt]));
        }
      } catch (err) {
        if (attempt < SUBTITLE_RETRY_DELAYS.length) {
          console.warn(
            `[handleTranscribe] Official subtitle threw for ${bvid} (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err} — retrying`,
          );
          await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_DELAYS[attempt]));
        }
      }
    }
    return null;
  };
}

function createTranscribeAudio(tabId: number, ctx: BackgroundContext) {
  return async (params: {
    bvid: string;
    cid: number;
    config: AsrConfig;
    signal: AbortSignal;
    title: string;
    onProgress: OnProgress;
  }): Promise<SubtitleRow[]> => {
    const { bvid, cid, config, signal, title, onProgress } = params;

    onProgress(PROGRESS.CONNECTIVITY_CHECK, 'connectivity');
    await ensureGroqConnectivity(config.apiKey, config.baseUrl);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    onProgress(PROGRESS.DOWNLOAD_BEGIN, 'extracting');
    let audioUrl: string;
    try {
      audioUrl = await extractBiliAudioUrl(bvid, cid);
    } catch (err) {
      throw createErrorInfo('ASR_NO_AUDIO_SOURCE', err instanceof Error ? err.message : 'Audio extraction failed');
    }

    onProgress(PROGRESS.DOWNLOAD_BEGIN + 1, 'downloading');
    const audioBlob = await fetchAudioBlob(audioUrl, signal, (p) =>
      onProgress(p, 'downloading'),
    );
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    await assertAudioNotReused(audioBlob, bvid);

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
    const sessionId = `${bvid}_${Date.now()}`;
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
  const { bvid, title } = msg;
  const tabId = sender.tab?.id ?? 0;

  const controller = ctx.startTranscription(tabId, bvid);
  if (!controller) {
    return {
      success: false,
      error: createErrorInfo('TRANSCRIBE_DUPLICATE', `Already transcribing ${bvid}`),
    };
  }

  try {
    const auth = await getBiliAuth();
    const cid = msg.cid || (await fetchCidByPageList(bvid, 1, auth ?? undefined));

    const deps = {
      getAsrConfig: async () => {
        const s = await settingsStorage.getValue();
        return resolveAsrConfig(s);
      },
      fetchOfficialSubtitle: createFetchOfficialSubtitle(auth),
      transcribeAudio: createTranscribeAudio(tabId, ctx),
      cacheGet: async (id: string) => {
        const entry = await getVideoCache(id);
        if (!entry) return null;
        return { rows: entry.rows, source: entry.source };
      },
      cacheSave: async (id: string, rows: SubtitleRow[], source: 'bilibili' | 'groq') => {
        await mergeVideoCache(id, rows, source);
      },
    };

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
  if (target) {
    notifyTab(ctx, target.tabId, target.bvid, progress, 'chunk_transcribing', undefined, stageParams);
    return;
  }

  for (const t of ctx.getActiveTranscriptions()) {
    notifyTab(ctx, t.tabId, t.bvid, progress, 'chunk_transcribing', undefined, stageParams);
  }
}
