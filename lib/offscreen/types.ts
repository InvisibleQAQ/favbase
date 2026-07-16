import type { SubtitleRow } from '@/lib/subtitle/types';
import type { TranscribeErrorInfo } from '@/lib/transcription/types';
import type { XAuth } from '@/lib/x/x-auth';

export type SubsystemState = 'pending' | 'ready' | 'failed';

export interface OffscreenStatus {
  ffmpeg: SubsystemState;
  pglite: SubsystemState;
}

export interface OffscreenStatusRequest {
  type: 'OFFSCREEN_STATUS';
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
  baseUrl: string;
}

export interface OffscreenReleaseRequest {
  type: 'OFFSCREEN_CHUNK_RELEASE';
  sessionId: string;
}

/** bg → offscreen: run the X bookmarks sync (offscreen holds PGlite directly). */
export interface OffscreenXSyncRequest {
  type: 'OFFSCREEN_X_SYNC';
  sessionId: string;
  /**
   * Captured x.com auth, resolved by the background SW — offscreen documents
   * have no `chrome.storage`, so tokens ride the message (same pattern as
   * `apiKey` on OFFSCREEN_CHUNK_TRANSCRIBE).
   */
  auth: XAuth;
}

/** offscreen → bg: running fetched count during an X sync (cursor pagination). */
export interface OffscreenXSyncProgressMessage {
  type: 'OFFSCREEN_X_SYNC_PROGRESS';
  sessionId: string;
  fetchedCount: number;
  page: number;
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
  | OffscreenReleaseRequest
  | OffscreenStatusRequest
  | OffscreenXSyncRequest;

export type OffscreenMessage =
  | OffscreenProgressMessage
  | OffscreenResultMessage
  | OffscreenErrorMessage
  | OffscreenXSyncProgressMessage;
