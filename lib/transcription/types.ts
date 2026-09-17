import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type { ASRProviderId } from '@/lib/providers';

export interface TranscribeRequest {
  type: 'TRANSCRIBE_AUDIO';
  platform: string;
  videoId: string;
  cid?: number;
  title: string;
}

export interface TranscribeAbort {
  type: 'TRANSCRIBE_ABORT';
  videoId: string;
}

export type TranscribeStage =
  | 'start'
  | 'subtitle_check'
  | 'connectivity'
  | 'extracting'
  | 'downloading'
  | 'uploading'
  | 'transcribing'
  | 'chunking'
  | 'chunk_transcribing'
  | 'processing'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface TranscribeStatusPush {
  type: 'TRANSCRIBE_STATUS';
  videoId: string;
  progress: number;
  stage: TranscribeStage;
  stageParams?: Record<string, string | number>;
  error?: TranscribeErrorInfo;
}

export interface TranscribeErrorInfo {
  code: TranscribeErrorCode;
  message: string;
  params?: Record<string, string | number>;
  retryAfter?: number;
  resetAt?: number;
  rateLimitKind?: TranscribeRateLimitKind;
  providerId?: ASRProviderId;
}

export type TranscribeRateLimitKind = 'audio_seconds_per_day';

export type TranscribeErrorCode =
  | 'ASR_REQUEST_TIMEOUT'
  | 'ASR_RATE_LIMIT'
  | 'ASR_QUOTA_EXCEEDED'
  | 'ASR_GROQ_UNREACHABLE'
  | 'ASR_GROQ_ACCESS_BLOCKED'
  | 'ASR_INVALID_KEY'
  | 'ASR_CHUNKING_FAILED'
  | 'ASR_CHUNKING_UNSUPPORTED'
  | 'ASR_CHUNK_DURATION_UNKNOWN'
  | 'ASR_AUDIO_REUSED'
  | 'ASR_NO_AUDIO_SOURCE'
  | 'DOWNLOAD_FAILED'
  | 'ASR_UNKNOWN'
  | 'TRANSCRIBE_DUPLICATE'
  | 'TRANSCRIBE_VIDEO_ID_MISMATCH'
  | 'UNSUPPORTED_PLATFORM';

export interface TranscribeSuccess {
  success: true;
  data: {
    /**
     * The video these rows belong to — the echo of `TranscribeRequest.videoId`.
     * Binding the payload to its request across the runtime boundary is what
     * lets a consumer refuse to persist a transcript that is not its own; a
     * caller holding only `rows` cannot tell whose subtitles it received.
     * Compare byte-exact: ids are case-sensitive (Bilibili BV ids are base58).
     */
    videoId: string;
    rows: SubtitleRow[];
    source: SubtitleSource;
    cached: boolean;
  };
}

export interface TranscribeFailure {
  success: false;
  error: TranscribeErrorInfo;
}

export type TranscribeResponse = TranscribeSuccess | TranscribeFailure;

export function createErrorInfo(
  code: TranscribeErrorCode,
  message: string,
  params?: Record<string, string | number>,
): TranscribeErrorInfo {
  return { code, message, ...(params && { params }) };
}

export function isTranscribeError(err: unknown): err is TranscribeErrorInfo {
  return (
    err != null &&
    typeof err === 'object' &&
    'code' in err &&
    'message' in err &&
    typeof (err as TranscribeErrorInfo).code === 'string'
  );
}
