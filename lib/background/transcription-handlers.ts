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
import { settingsStorage, resolveAsrConfig } from '@/lib/storage';
import { getAsrProviderDef } from '@/lib/providers';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
  AsrError,
} from '@/lib/transcription/groq-client';
import {
  fetchAudioBlob,
  AudioExtractError,
} from '@/lib/transcription/audio-extractor';
import {
  extractBiliAudioUrl,
  getBiliAuth,
  fetchCidByPageList,
  fetchSubtitle,
} from '@/lib/bilibili/bilibili-api';
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
  msg: { bvid: string; cid?: number; title: string },
  tabId: number,
  ctx: BackgroundContext,
): Promise<TranscribeResponse> {
  const { bvid, title } = msg;

  // Check cache first — avoid redundant subtitle/ASR calls
  const cached = await getVideoCache(bvid);
  if (cached && cached.rows.length > 0) {
    return {
      success: true,
      data: { rows: cached.rows, source: cached.source, cached: true },
    };
  }

  // Resolve CID: use caller-provided value or fetch from API
  const auth = await getBiliAuth();
  const cid = msg.cid || (await fetchCidByPageList(bvid, 1, auth ?? undefined));

  // Try official subtitle before ASR pipeline (retry up to 2 times on error)
  const RETRY_DELAYS = [1000, 2000];
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const subtitleResult = await fetchSubtitle(bvid, cid, auth ?? undefined);

      if (subtitleResult.status === 'ok' && subtitleResult.rows.length > 0) {
        const rows = processSubtitles(subtitleResult.rows);
        await mergeVideoCache(bvid, rows, 'bilibili');
        return {
          success: true,
          data: { rows, source: 'bilibili', cached: false },
        };
      }

      if (subtitleResult.status === 'no_subtitle') {
        break;
      }

      // status === 'error': API rejected the request — retry or fall through
      if (attempt < RETRY_DELAYS.length) {
        console.warn(
          `[handleTranscribe] Official subtitle fetch error for ${bvid} (attempt ${attempt + 1}): ${subtitleResult.error ?? 'unknown'} — retrying in ${RETRY_DELAYS[attempt]}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        console.warn(
          `[handleTranscribe] Official subtitle fetch failed for ${bvid} after ${attempt + 1} attempts: ${subtitleResult.error ?? 'unknown'} — falling back to ASR`,
        );
      }
    } catch (err) {
      // Network-level failure — same retry logic
      if (attempt < RETRY_DELAYS.length) {
        console.warn(
          `[handleTranscribe] Official subtitle fetch threw for ${bvid} (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err} — retrying in ${RETRY_DELAYS[attempt]}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        console.warn(
          `[handleTranscribe] Official subtitle fetch threw for ${bvid} after ${attempt + 1} attempts: ${err instanceof Error ? err.message : err} — falling back to ASR`,
        );
      }
    }
  }

  const settings = await settingsStorage.getValue();
  const asrConfig = resolveAsrConfig(settings);
  const asrDef = getAsrProviderDef(settings.asrProvider);

  const controller = new AbortController();
  ctx.tabAbortControllers.set(tabId, controller);
  tabBvids.set(tabId, bvid);

  const deps = {
    getAsrConfig: async () => asrConfig,
    checkCache: async (id: string) => {
      const entry = await getVideoCache(id);
      if (!entry || entry.rows.length === 0) return null;
      return { rows: entry.rows, source: entry.source };
    },
    saveCache: async (id: string, rows: SubtitleRow[]) => {
      await mergeVideoCache(id, rows, 'groq');
    },
    ensureConnectivity: (apiKey: string) =>
      ensureGroqConnectivity(apiKey, asrDef.baseUrl),
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
      const result = await requestGroqTranscription(blob, apiKey, model, signal, asrDef.baseUrl);
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
          baseUrl: asrDef.baseUrl,
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
