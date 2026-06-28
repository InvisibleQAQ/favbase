export interface BackgroundContext {
  sendToTab(tabId: number, message: unknown): void;
  ensureOffscreen(): Promise<void>;

  startTranscription(tabId: number, bvid: string): AbortController | null;
  abortTranscription(tabId: number): void;
  finishTranscription(tabId: number): void;
  getBvidForTab(tabId: number): string | undefined;

  registerChunkSession(sessionId: string, tabId: number): void;
  unregisterChunkSession(sessionId: string): void;
  resolveProgressTarget(sessionId: string): { tabId: number; bvid: string } | null;
  getActiveTranscriptions(): Array<{ tabId: number; bvid: string }>;
}
