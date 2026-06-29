import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import {
  isTranscribeError,
  type TranscribeResponse,
  type TranscribeStage,
  type TranscribeErrorInfo,
} from './types';
import { PROGRESS } from './constants';

export interface AsrConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface PipelineDeps {
  getAsrConfig(): Promise<AsrConfig>;
  fetchOfficialSubtitle(
    videoId: string,
    cid: number,
  ): Promise<SubtitleRow[] | null>;
  transcribeAudio(params: {
    videoId: string;
    cid: number;
    config: AsrConfig;
    signal: AbortSignal;
    title: string;
    onProgress: OnProgress;
  }): Promise<SubtitleRow[]>;
  cacheGet(
    videoId: string,
  ): Promise<{ rows: SubtitleRow[]; source: SubtitleSource } | null>;
  cacheSave(
    videoId: string,
    rows: SubtitleRow[],
    source: SubtitleSource,
  ): Promise<void>;
  postProcess(rows: SubtitleRow[]): SubtitleRow[];
}

export interface PipelineRequest {
  videoId: string;
  cid: number;
  title: string;
  signal: AbortSignal;
  officialSourceLabel: SubtitleSource;
  asrSourceLabel: SubtitleSource;
}

export type OnProgress = (
  progress: number,
  stage: TranscribeStage,
  stageParams?: Record<string, string | number>,
) => void;

function toErrorInfo(err: unknown): TranscribeErrorInfo {
  if (isTranscribeError(err)) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { code: 'ASR_REQUEST_TIMEOUT', message: 'Operation aborted' };
  }
  const detail = err instanceof Error ? err.message : 'unknown error';
  return { code: 'ASR_UNKNOWN', message: detail, params: { detail } };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function runTranscriptionPipeline(
  request: PipelineRequest,
  deps: PipelineDeps,
  onProgress: OnProgress,
): Promise<TranscribeResponse> {
  const { videoId, cid, title, signal, officialSourceLabel, asrSourceLabel } = request;

  const cached = await deps.cacheGet(videoId);
  if (cached) {
    return { success: true, data: { ...cached, cached: true } };
  }

  try {
    onProgress(PROGRESS.START, 'start');

    onProgress(PROGRESS.SUBTITLE_CHECK, 'subtitle_check');
    const official = await deps.fetchOfficialSubtitle(videoId, cid);
    if (official) {
      const rows = deps.postProcess(official);
      await deps.cacheSave(videoId, rows, officialSourceLabel);
      onProgress(PROGRESS.DONE, 'done');
      return { success: true, data: { rows, source: officialSourceLabel, cached: false } };
    }

    assertNotAborted(signal);

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

    const rawRows = await deps.transcribeAudio({
      videoId, cid, config, signal, title, onProgress,
    });

    onProgress(PROGRESS.PARSING, 'processing');
    const rows = deps.postProcess(rawRows);

    await deps.cacheSave(videoId, rows, asrSourceLabel);
    onProgress(PROGRESS.DONE, 'done');

    return { success: true, data: { rows, source: asrSourceLabel, cached: false } };
  } catch (err) {
    return { success: false, error: toErrorInfo(err) };
  }
}
