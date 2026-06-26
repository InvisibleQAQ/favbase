import {
  PipelineError,
  type SubtitleRow,
  type TranscribeResponse,
  type TranscribeStage,
  type TranscribeErrorInfo,
} from './types';
import { GROQ_MAX_AUDIO_BYTES, PROGRESS } from './constants';

export interface AsrConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface PipelineDeps {
  getAsrConfig(): Promise<AsrConfig>;
  checkCache(
    bvid: string,
  ): Promise<{ rows: SubtitleRow[]; source: 'bilibili' | 'groq' } | null>;
  saveCache(bvid: string, rows: SubtitleRow[]): Promise<void>;
  ensureConnectivity(apiKey: string, baseUrl: string): Promise<void>;
  extractAudioUrl(bvid: string, cid: number): Promise<string>;
  fetchAudio(
    url: string,
    signal: AbortSignal,
    onProgress: (p: number) => void,
  ): Promise<Blob>;
  checkAudioReuse(blob: Blob, bvid: string): Promise<void>;
  transcribeDirect(
    blob: Blob,
    apiKey: string,
    model: string,
    signal: AbortSignal,
    baseUrl: string,
  ): Promise<SubtitleRow[]>;
  transcribeChunked(
    audioUrl: string,
    apiKey: string,
    model: string,
    title: string,
    baseUrl: string,
  ): Promise<SubtitleRow[]>;
  processSubtitles(rows: SubtitleRow[]): SubtitleRow[];
}

export interface PipelineRequest {
  bvid: string;
  cid: number;
  title: string;
  signal: AbortSignal;
}

export type OnProgress = (
  progress: number,
  stage: TranscribeStage,
  stageParams?: Record<string, string | number>,
) => void;

function toErrorInfo(err: unknown): TranscribeErrorInfo {
  if (err instanceof PipelineError) return err.info;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { code: 'ASR_REQUEST_TIMEOUT', message: 'Operation aborted' };
  }
  const detail = err instanceof Error ? err.message : 'unknown error';
  return { code: 'ASR_UNKNOWN', message: detail, params: { detail } };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function transcribeWithFakeProgress(
  audioBlob: Blob,
  config: AsrConfig,
  signal: AbortSignal,
  deps: PipelineDeps,
  onProgress: OnProgress,
): Promise<SubtitleRow[]> {
  let current: number = PROGRESS.UPLOAD_BEGIN;
  const timer = setInterval(() => {
    if (signal.aborted) return;
    current = Math.min(PROGRESS.UPLOAD_END, current + 2 + Math.random() * 2);
    onProgress(Math.round(current), 'transcribing');
  }, 2000);

  try {
    return await deps.transcribeDirect(
      audioBlob,
      config.apiKey,
      config.model,
      signal,
      config.baseUrl,
    );
  } finally {
    clearInterval(timer);
  }
}

export async function runTranscriptionPipeline(
  request: PipelineRequest,
  deps: PipelineDeps,
  onProgress: OnProgress,
): Promise<TranscribeResponse> {
  const { bvid, cid, title, signal } = request;

  const cached = await deps.checkCache(bvid);
  if (cached) {
    return { success: true, data: { ...cached, cached: true } };
  }

  const config = await deps.getAsrConfig();
  if (!config.apiKey) {
    return {
      success: false,
      error: {
        code: 'ASR_INVALID_KEY',
        message: 'ASR API key not configured',
      },
    };
  }

  try {
    onProgress(PROGRESS.START, 'start');

    onProgress(PROGRESS.CONNECTIVITY_CHECK, 'connectivity');
    await deps.ensureConnectivity(config.apiKey, config.baseUrl);
    assertNotAborted(signal);

    onProgress(PROGRESS.DOWNLOAD_BEGIN, 'extracting');
    const audioUrl = await deps.extractAudioUrl(bvid, cid);

    onProgress(PROGRESS.DOWNLOAD_BEGIN + 1, 'downloading');
    const audioBlob = await deps.fetchAudio(audioUrl, signal, (p) =>
      onProgress(p, 'downloading'),
    );
    assertNotAborted(signal);

    await deps.checkAudioReuse(audioBlob, bvid);

    let rows: SubtitleRow[];
    if (audioBlob.size <= GROQ_MAX_AUDIO_BYTES) {
      onProgress(PROGRESS.PREPARE_UPLOAD, 'uploading');
      rows = await transcribeWithFakeProgress(
        audioBlob,
        config,
        signal,
        deps,
        onProgress,
      );
    } else {
      onProgress(PROGRESS.CHUNK_PREPARE, 'chunking');
      rows = await deps.transcribeChunked(
        audioUrl,
        config.apiKey,
        config.model,
        title,
        config.baseUrl,
      );
    }

    onProgress(PROGRESS.PARSING, 'processing');
    rows = deps.processSubtitles(rows);

    await deps.saveCache(bvid, rows);
    onProgress(PROGRESS.DONE, 'done');

    return { success: true, data: { rows, source: 'groq', cached: false } };
  } catch (err) {
    return { success: false, error: toErrorInfo(err) };
  }
}
