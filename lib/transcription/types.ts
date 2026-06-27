export interface SubtitleRow {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleResult {
  status: 'ok' | 'no_subtitle' | 'error';
  rows: SubtitleRow[];
  source?: 'bilibili' | 'groq';
  error?: string;
}

export interface TranscribeRequest {
  type: 'TRANSCRIBE_AUDIO';
  bvid: string;
  cid?: number;
  title: string;
}

export interface TranscribeAbort {
  type: 'TRANSCRIBE_ABORT';
  bvid: string;
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
  bvid: string;
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
}

export type TranscribeErrorCode =
  | 'ASR_REQUEST_TIMEOUT'
  | 'ASR_RATE_LIMIT'
  | 'ASR_GROQ_UNREACHABLE'
  | 'ASR_GROQ_ACCESS_BLOCKED'
  | 'ASR_INVALID_KEY'
  | 'ASR_FILE_TOO_LARGE'
  | 'ASR_CHUNKING_FAILED'
  | 'ASR_CHUNKING_UNSUPPORTED'
  | 'ASR_CHUNK_DURATION_UNKNOWN'
  | 'ASR_AUDIO_REUSED'
  | 'ASR_AUDIO_BVID_MISMATCH'
  | 'ASR_NO_AUDIO_SOURCE'
  | 'DOWNLOAD_FAILED'
  | 'ASR_UNKNOWN';

export interface TranscribeSuccess {
  success: true;
  data: {
    rows: SubtitleRow[];
    source: 'bilibili' | 'groq';
    cached: boolean;
  };
}

export interface TranscribeFailure {
  success: false;
  error: TranscribeErrorInfo;
}

export type TranscribeResponse = TranscribeSuccess | TranscribeFailure;

export class PipelineError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
    this.name = 'PipelineError';
  }
}
