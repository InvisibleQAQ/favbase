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
  | 'transcribing'
  | 'waiting'
  | 'paused'
  | 'configuration_required'
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
  /** True while one or more session items are parked for missing ASR config. */
  asrBlocked: boolean;
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
}

// ---------------------------------------------------------------------------
// Platform adapter interface
// ---------------------------------------------------------------------------

export interface AutoTranscribeAdapter {
  /**
   * Transcribe + persist + index. `onIndexing` fires after transcription
   * succeeds, while local chunk+embed indexing runs (UI "indexing" stage).
   */
  transcribe(videoId: string, title: string, onIndexing?: () => void): Promise<TranscribeResponse>;
  markError(videoId: string): Promise<void>;
  hasAsrKey(): Promise<boolean>;
  waitForAsrKey(): Promise<void>;
  getQuotaPause(): Promise<AutoTranscribeQuotaPause | null>;
  setQuotaPause(pause: AutoTranscribeQuotaPause | null): Promise<void>;
  createStatusListener(
    matchVideoId: () => string,
    onStatus: (push: { progress: number; stage: string }) => void,
  ): () => void;
}
