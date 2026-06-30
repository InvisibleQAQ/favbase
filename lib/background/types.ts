export interface BackgroundContext {
  sendToTab(tabId: number, message: unknown): void;
  ensureOffscreen(): Promise<void>;

  startTranscription(tabId: number, videoId: string): AbortController | null;
  abortTranscription(tabId: number): void;
  finishTranscription(tabId: number): void;
  getVideoIdForTab(tabId: number): string | undefined;

  registerChunkSession(sessionId: string, tabId: number): void;
  unregisterChunkSession(sessionId: string): void;
  resolveProgressTarget(sessionId: string): { tabId: number; videoId: string } | null;
}
