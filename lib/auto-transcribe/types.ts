import type { TranscribeResponse } from '@/lib/transcription/types';
import type { ASRProviderId } from '@/lib/providers';

// ---------------------------------------------------------------------------
// Generic video & page types
// ---------------------------------------------------------------------------

export interface AutoTranscribeVideo {
  videoId: string;
  title: string;
  cover: string;
  author: string;
  duration: number;
  isInvalid: boolean;
}

export interface AutoTranscribePageResult {
  videos: AutoTranscribeVideo[];
  totalPages: number;
  totalCount: number;
}

export interface AutoTranscribePreview {
  video: AutoTranscribeCurrentVideo | null;
  pendingCount: number | null;
}

export interface AutoTranscribeQuotaPause {
  providerId: ASRProviderId;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// State types (consumed by UI via useSyncExternalStore)
// ---------------------------------------------------------------------------

export type AutoTranscribePhase =
  | 'idle'
  | 'syncing'
  | 'transcribing'
  | 'waiting'
  | 'paused'
  | 'quota_paused'
  | 'done'
  | 'cancelled';

export interface AutoTranscribeStats {
  existing: number;
  cc: number;
  asr: number;
  skipped: number;
  remaining: number;
}

export interface AutoTranscribeCurrentVideo {
  cover: string;
  title: string;
  author: string;
  duration: number;
}

export interface AutoTranscribeState {
  phase: AutoTranscribePhase;
  currentPage: number;
  totalPages: number;
  currentVideoTitle: string;
  currentVideoId: string;
  currentVideo: AutoTranscribeCurrentVideo | null;
  totalVideos: number;
  currentIndex: number;
  videoProgress: number;
  videoStage: string;
  waitSeconds: number;
  quotaResetAt: number | null;
  stats: AutoTranscribeStats;
  previewVideo: AutoTranscribeCurrentVideo | null;
  pendingCount: number | null;
  previewLoading: boolean;
}

// ---------------------------------------------------------------------------
// Platform adapter interface
// ---------------------------------------------------------------------------

export interface AutoTranscribeAdapter {
  checkAuth(): Promise<void>;
  fetchPage(collectionId: string, page: number): Promise<AutoTranscribePageResult>;
  getPendingIds(videoIds: string[]): Promise<string[]>;
  getPreview(collectionId: string): Promise<AutoTranscribePreview>;
  /**
   * Transcribe + persist + index. `onIndexing` fires after transcription
   * succeeds, while local chunk+embed indexing runs (UI "indexing" stage).
   */
  transcribe(videoId: string, title: string, onIndexing?: () => void): Promise<TranscribeResponse>;
  markError(videoId: string): Promise<void>;
  hasAsrKey(): Promise<boolean>;
  getQuotaPause(): Promise<AutoTranscribeQuotaPause | null>;
  setQuotaPause(pause: AutoTranscribeQuotaPause | null): Promise<void>;
  createStatusListener(
    matchVideoId: () => string,
    onStatus: (push: { progress: number; stage: string }) => void,
  ): () => void;
}
