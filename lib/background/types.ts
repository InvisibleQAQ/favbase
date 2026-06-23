import type { TranscribeStage, TranscribeErrorInfo } from '@/lib/transcription/types';

export interface BackgroundContext {
  tabAbortControllers: Map<number, AbortController>;
  tabBvids: Map<number, string>;
  notifyTab(
    tabId: number,
    bvid: string,
    progress: number,
    stage: TranscribeStage,
    error?: TranscribeErrorInfo,
    stageParams?: Record<string, string | number>,
  ): void;
  ensureOffscreen(): Promise<void>;
}
