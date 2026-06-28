import {
  isTranscribeError,
  type SubtitleRow,
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
    bvid: string,
    cid: number,
  ): Promise<SubtitleRow[] | null>;
  transcribeAudio(params: {
    bvid: string;
    cid: number;
    config: AsrConfig;
    signal: AbortSignal;
    title: string;
    onProgress: OnProgress;
  }): Promise<SubtitleRow[]>;
  cacheGet(
    bvid: string,
  ): Promise<{ rows: SubtitleRow[]; source: 'bilibili' | 'groq' } | null>;
  cacheSave(
    bvid: string,
    rows: SubtitleRow[],
    source: 'bilibili' | 'groq',
  ): Promise<void>;
  postProcess(rows: SubtitleRow[]): SubtitleRow[];
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
  const { bvid, cid, title, signal } = request;

  const cached = await deps.cacheGet(bvid);
  if (cached) {
    return { success: true, data: { ...cached, cached: true } };
  }

  try {
    onProgress(PROGRESS.START, 'start');

    onProgress(PROGRESS.SUBTITLE_CHECK, 'subtitle_check');
    const official = await deps.fetchOfficialSubtitle(bvid, cid);
    if (official) {
      const rows = deps.postProcess(official);
      await deps.cacheSave(bvid, rows, 'bilibili');
      onProgress(PROGRESS.DONE, 'done');
      return { success: true, data: { rows, source: 'bilibili', cached: false } };
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
      bvid, cid, config, signal, title, onProgress,
    });

    onProgress(PROGRESS.PARSING, 'processing');
    const rows = deps.postProcess(rawRows);

    await deps.cacheSave(bvid, rows, 'groq');
    onProgress(PROGRESS.DONE, 'done');

    return { success: true, data: { rows, source: 'groq', cached: false } };
  } catch (err) {
    return { success: false, error: toErrorInfo(err) };
  }
}
