/**
 * Per-tab, per-video job bookkeeping shared by every long-running background
 * job (transcription, summary). Each job kind owns one registry instance, so
 * aborting a summary never touches a transcription in the same tab.
 *
 * Extracted from `createBackgroundContext`'s original transcription-only
 * triple (abortControllers / tabVideoIds / activeVideoIds).
 */
export interface JobRegistry {
  /** Returns null when the same videoId is already running (dedup). */
  start(tabId: number, videoId: string): AbortController | null;
  abort(tabId: number): void;
  /**
   * Release the slot a finished job owns. The job must hand back the very
   * controller `start` gave it: after an abort-then-restart in the same tab the
   * old job's cleanup runs *after* the new job registered, and an unconditional
   * release would silently deregister the live job (unabortable + dedup hole).
   */
  finish(tabId: number, controller: AbortController): void;
  getVideoId(tabId: number): string | undefined;
}

export function createJobRegistry(): JobRegistry {
  const controllers = new Map<number, AbortController>();
  const tabVideoIds = new Map<number, string>();
  const activeVideoIds = new Set<string>();

  function release(tabId: number): void {
    const videoId = tabVideoIds.get(tabId);
    if (videoId) activeVideoIds.delete(videoId.toLowerCase());
    controllers.delete(tabId);
    tabVideoIds.delete(tabId);
  }

  return {
    start(tabId, videoId) {
      const key = videoId.toLowerCase();
      if (activeVideoIds.has(key)) return null;

      // A tab can only run one job of this kind — the previous video's slot is
      // released before the new one takes it.
      const prevVideoId = tabVideoIds.get(tabId);
      if (prevVideoId) activeVideoIds.delete(prevVideoId.toLowerCase());

      activeVideoIds.add(key);
      const controller = new AbortController();
      controllers.set(tabId, controller);
      tabVideoIds.set(tabId, videoId);
      return controller;
    },

    abort(tabId) {
      controllers.get(tabId)?.abort();
      release(tabId);
    },

    finish(tabId, controller) {
      // A newer job already owns this tab's slot — leave it alone.
      if (controllers.get(tabId) !== controller) return;
      release(tabId);
    },

    getVideoId(tabId) {
      return tabVideoIds.get(tabId);
    },
  };
}
