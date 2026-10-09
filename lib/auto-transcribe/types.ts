import type { TranscribePrerequisite } from '@/lib/collections/configuration-blockers';
import type { TranscribeErrorInfo, TranscribeResponse } from '@/lib/transcription/types';
import type { ASRProviderId } from '@/lib/providers';

export type { TranscribePrerequisite };

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
  /**
   * Non-null while one or more session items are parked waiting for this
   * prerequisite (an ASR key, the platform's own tab). A UI blocking signal
   * independent of `phase`: the session may still be transcribing other items.
   */
  prerequisiteBlocked: TranscribePrerequisite | null;
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
  /**
   * Judged NOW (the configuration / tab state at this moment), not from the
   * error alone: `null` = an ordinary per-item failure (mark error, move on);
   * otherwise the prerequisite the item is parked for and retried after.
   */
  missingPrerequisite(error: TranscribeErrorInfo): Promise<TranscribePrerequisite | null>;
  /**
   * Resolves once the prerequisite `error` was parked for is back. Called once
   * per park episode, with the FIRST parked error; items parked later share
   * that wait.
   */
  waitForPrerequisite(error: TranscribeErrorInfo): Promise<void>;
  getQuotaPause(): Promise<AutoTranscribeQuotaPause | null>;
  setQuotaPause(pause: AutoTranscribeQuotaPause | null): Promise<void>;
  createStatusListener(
    matchVideoId: () => string,
    onStatus: (push: { progress: number; stage: string }) => void,
  ): () => void;
}
