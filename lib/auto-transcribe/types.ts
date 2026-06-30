import type { TranscribeResponse } from '@/lib/transcription/types';

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
  pendingCount: number;
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
  stats: AutoTranscribeStats;
  previewVideo: AutoTranscribeCurrentVideo | null;
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Platform adapter interface
// ---------------------------------------------------------------------------

export interface AutoTranscribeAdapter {
  checkAuth(): Promise<void>;
  fetchPage(collectionId: string, page: number): Promise<AutoTranscribePageResult>;
  getPendingIds(videoIds: string[]): Promise<string[]>;
  getPreview(collectionId: string): Promise<AutoTranscribePreview>;
  transcribe(videoId: string, title: string): Promise<TranscribeResponse>;
  markError(videoId: string): Promise<void>;
  hasAsrKey(): Promise<boolean>;
  createStatusListener(
    matchVideoId: () => string,
    onStatus: (push: { progress: number; stage: string }) => void,
  ): () => void;
}
