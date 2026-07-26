export interface BackgroundContext {
  sendToTab(tabId: number, message: unknown): void;
  ensureOffscreen(): Promise<void>;

  startTranscription(tabId: number, videoId: string): AbortController | null;
  abortTranscription(tabId: number): void;
  /** Pass back the controller `startTranscription` returned — see JobRegistry. */
  finishTranscription(tabId: number, controller: AbortController): void;
  getVideoIdForTab(tabId: number): string | undefined;

  /** Summary jobs run on their own registry — a video can transcribe and
   *  summarize independently, and aborting one must not cancel the other. */
  startSummary(tabId: number, videoId: string): AbortController | null;
  abortSummary(tabId: number): void;
  finishSummary(tabId: number, controller: AbortController): void;

  registerChunkSession(sessionId: string, tabId: number): void;
  unregisterChunkSession(sessionId: string): void;
  resolveProgressTarget(sessionId: string): { tabId: number; videoId: string } | null;
}
