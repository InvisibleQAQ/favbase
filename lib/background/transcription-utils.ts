import type { BackgroundContext } from './types';
import type { SubtitleRow } from '@/lib/subtitle/types';
import type {
  TranscribeStage,
  TranscribeStatusPush,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import { sendOffscreenMessage } from '@/lib/offscreen/client';
import {
  ensureGroqConnectivity,
  requestGroqTranscription,
} from '@/lib/transcription/groq-client';
import { fetchAudioBlob } from '@/lib/transcription/audio-extractor';
import { assertAudioNotReused } from '@/lib/transcription/audio-fingerprint';
import { createErrorInfo } from '@/lib/transcription/types';
import { GROQ_MAX_AUDIO_BYTES, PROGRESS } from '@/lib/transcription/constants';
import type { AsrConfig, OnProgress } from '@/lib/transcription/pipeline';

export type MessageSender = { tab?: { id?: number } };

export function notifyTab(
  ctx: BackgroundContext,
  tabId: number,
  videoId: string,
  progress: number,
  stage: TranscribeStage,
  error?: TranscribeErrorInfo,
  stageParams?: Record<string, string | number>,
): void {
  const msg: TranscribeStatusPush = {
    type: 'TRANSCRIBE_STATUS',
    videoId,
    progress,
    stage,
    stageParams,
    error,
  };
  ctx.sendToTab(tabId, msg);
}

export function createTranscribeAudio(
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
      const prepareRes = await sendOffscreenMessage({
        type: 'OFFSCREEN_CHUNK_PREPARE',
        sessionId,
        audioUrl,
        maxBytes: GROQ_MAX_AUDIO_BYTES,
      });
      if (!prepareRes.success) throw prepareRes.error;

      const transcribeRes = await sendOffscreenMessage({
        type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
        sessionId,
        apiKey: config.apiKey,
        model: config.model,
        title,
        baseUrl: config.baseUrl,
      });
      if (!transcribeRes.success) throw transcribeRes.error;
      return transcribeRes.rows;
    } finally {
      await sendOffscreenMessage({ type: 'OFFSCREEN_CHUNK_RELEASE', sessionId }).catch(() => {});
      ctx.unregisterChunkSession(sessionId);
    }
  };
}
