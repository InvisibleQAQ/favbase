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

/**
 * The pipeline is the sole owner of `TranscribeSuccess.data.videoId`: it holds
 * the three places a success can be returned (cache hit, official subtitle,
 * ASR) and it is platform-agnostic, so every platform gets the stamp for free.
 * Letting each platform handler stamp its own would be the same line copied per
 * platform, and the one that forgets is exactly the one that needs it.
 *
 * The value is the *requested* id — the pipeline has no deeper source of truth
 * (cache, official subtitle and ASR are all addressed by this same id). The
 * stamp therefore binds the payload to its request, so a response delivered to
 * the wrong caller stops at that caller's gate instead of reaching the DB.
 */
export async function runTranscriptionPipeline(
  request: PipelineRequest,
  deps: PipelineDeps,
  onProgress: OnProgress,
): Promise<TranscribeResponse> {
  const { videoId, cid, title, signal, officialSourceLabel, asrSourceLabel } = request;

  const cached = await deps.cacheGet(videoId);
  if (cached) {
    // Stamp last: the requested id outranks anything the cache hands back.
    return { success: true, data: { ...cached, videoId, cached: true } };
  }

  try {
    onProgress(PROGRESS.START, 'start');

    onProgress(PROGRESS.SUBTITLE_CHECK, 'subtitle_check');
    const official = await deps.fetchOfficialSubtitle(videoId, cid);
    if (official) {
      const rows = deps.postProcess(official);
      await deps.cacheSave(videoId, rows, officialSourceLabel);
      onProgress(PROGRESS.DONE, 'done');
      return { success: true, data: { videoId, rows, source: officialSourceLabel, cached: false } };
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

    return { success: true, data: { videoId, rows, source: asrSourceLabel, cached: false } };
  } catch (err) {
    return { success: false, error: toErrorInfo(err) };
  }
}
