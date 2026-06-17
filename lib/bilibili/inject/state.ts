export interface InjectState {
  isSubtitleCaptured: boolean;
  capturedBvid: string;
  cachedSubtitleBody: unknown[] | null;
  routeGeneration: number;

  autoTriggerTimer: ReturnType<typeof setTimeout> | null;
  autoTriggerStarted: boolean;
  autoTriggerAttempts: number;

  stealthRestoreTimer: ReturnType<typeof setTimeout> | null;

  routeResolveTimer: ReturnType<typeof setTimeout> | null;
  lastBvid: string;
  lastPageNum: number;

  reemitTimer: ReturnType<typeof setInterval> | null;

  originalFetch: typeof fetch;
  originalXhrOpen: typeof XMLHttpRequest.prototype.open;
  originalXhrSend: typeof XMLHttpRequest.prototype.send;
}

export function createState(): InjectState {
  return {
    isSubtitleCaptured: false,
    capturedBvid: '',
    cachedSubtitleBody: null,
    routeGeneration: 0,

    autoTriggerTimer: null,
    autoTriggerStarted: false,
    autoTriggerAttempts: 0,

    stealthRestoreTimer: null,

    routeResolveTimer: null,
    lastBvid: '',
    lastPageNum: 1,

    reemitTimer: null,

    originalFetch: window.fetch,
    originalXhrOpen: XMLHttpRequest.prototype.open,
    originalXhrSend: XMLHttpRequest.prototype.send,
  };
}
