export interface BackgroundContext {
  tabAbortControllers: Map<number, AbortController>;
  sendToTab(tabId: number, message: unknown): void;
  ensureOffscreen(): Promise<void>;
}
