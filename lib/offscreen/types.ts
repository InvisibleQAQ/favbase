import type { SubtitleRow, TranscribeErrorInfo } from '@/lib/transcription/types';

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
  baseUrl: string;
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
