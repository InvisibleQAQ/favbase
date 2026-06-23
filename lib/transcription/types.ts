import type { SubtitleRow } from '../types';

export interface TranscribeRequest {
  type: 'TRANSCRIBE_AUDIO';
  bvid: string;
  cid: number;
  title: string;
}

export interface TranscribeAbort {
  type: 'TRANSCRIBE_ABORT';
  bvid: string;
}

export type TranscribeStage =
  | 'start'
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

export interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

export interface GroqTranscriptionResponse {
  text: string;
  segments?: GroqSegment[];
}

export interface GroqQuota {
  remainingTokens: number;
  remainingRequests: number;
  resetTokens: string;
}

export interface GroqTranscriptionResult {
  rows: SubtitleRow[];
  quota: GroqQuota;
}

export interface ChunkPlan {
  index: number;
  startSec: number;
  durationSec: number;
  endSec: number;
}

export interface OffscreenPrepareRequest {
  type: 'OFFSCREEN_CHUNK_PREPARE';
  sessionId: string;
  audioUrl: string;
  maxBytes: number;
}

export interface OffscreenTranscribeRequest {
  type: 'OFFSCREEN_CHUNK_TRANSCRIBE';
  sessionId: string;
  apiKey: string;
  model: string;
  title: string;
}

export interface OffscreenReleaseRequest {
  type: 'OFFSCREEN_CHUNK_RELEASE';
  sessionId: string;
}

export interface OffscreenProgressMessage {
  type: 'OFFSCREEN_CHUNK_PROGRESS';
  sessionId: string;
  chunkIndex: number;
  totalChunks: number;
}

export interface OffscreenResultMessage {
  type: 'OFFSCREEN_CHUNK_RESULT';
  sessionId: string;
  rows: SubtitleRow[];
}

export interface OffscreenErrorMessage {
  type: 'OFFSCREEN_CHUNK_ERROR';
  sessionId: string;
  error: TranscribeErrorInfo;
}

export type OffscreenRequest =
  | OffscreenPrepareRequest
  | OffscreenTranscribeRequest
  | OffscreenReleaseRequest;

export type OffscreenMessage =
  | OffscreenProgressMessage
  | OffscreenResultMessage
  | OffscreenErrorMessage;

export interface VideoCacheEntry {
  bvid: string;
  rows: SubtitleRow[];
  source: 'bilibili' | 'groq';
  rawHash: string;
  updatedAt: number;
}

export interface GetVideoCacheRequest {
  type: 'GET_VIDEO_CACHE';
  bvid: string;
}

export interface CacheSubtitleRequest {
  type: 'CACHE_SUBTITLE';
  bvid: string;
  rows: SubtitleRow[];
  source: 'bilibili' | 'groq';
}

export type BgMessage =
  | TranscribeRequest
  | TranscribeAbort
  | GetVideoCacheRequest
  | CacheSubtitleRequest;
