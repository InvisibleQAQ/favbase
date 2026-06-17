import { extractBvid, extractPageNum } from '../video-info';
import type { InjectState } from './state';
import { stopAutoTriggerFlow, removeStealthMask, scheduleAutoTriggerFlow } from './cc-trigger';
import { resolvePageMeta, postSubtitleData } from './subtitle-interceptor';

function emitInitialHandshake(s: InjectState): void {
  const meta = resolvePageMeta();
  if (meta.bvid) {
    s.capturedBvid = meta.bvid;
    window.postMessage(
      { type: 'BILI_SUBTITLE_HANDSHAKE', bvid: meta.bvid, cid: meta.cid },
      '*',
    );
  }
}

function stopReemitLoop(s: InjectState): void {
  if (s.reemitTimer) {
    clearInterval(s.reemitTimer);
    s.reemitTimer = null;
  }
}

export function startReemitLoop(s: InjectState): void {
  stopReemitLoop(s);
  let ticks = 0;
  s.reemitTimer = setInterval(() => {
    ticks++;
    if (ticks > 10) {
      stopReemitLoop(s);
      return;
    }
    if (s.isSubtitleCaptured && s.cachedSubtitleBody) {
      postSubtitleData(s, s.cachedSubtitleBody);
    } else {
      emitInitialHandshake(s);
    }
  }, 1000);
}

export function hardResetForRoute(s: InjectState, newBvid: string): void {
  s.routeGeneration++;
  s.isSubtitleCaptured = false;
  s.autoTriggerStarted = false;
  s.autoTriggerAttempts = 0;
  s.capturedBvid = newBvid;
  s.cachedSubtitleBody = null;
  stopAutoTriggerFlow(s);
  stopReemitLoop(s);
  if (s.stealthRestoreTimer) {
    clearTimeout(s.stealthRestoreTimer);
    s.stealthRestoreTimer = null;
  }
  removeStealthMask();
  if (s.routeResolveTimer) clearTimeout(s.routeResolveTimer);

  window.postMessage({ type: 'BILI_ROUTE_SWITCH', bvid: newBvid }, '*');

  s.routeResolveTimer = setTimeout(() => {
    emitInitialHandshake(s);
    scheduleAutoTriggerFlow(s);
    startReemitLoop(s);
  }, 800);
}

export function startRouteMonitor(s: InjectState): void {
  s.lastBvid = extractBvid(location.href) ?? '';
  s.lastPageNum = extractPageNum(location.href);

  setInterval(() => {
    const currentBvid = extractBvid(location.href) ?? '';
    const currentPageNum = extractPageNum(location.href);

    if (currentBvid === s.lastBvid && currentPageNum === s.lastPageNum) return;

    s.lastBvid = currentBvid;
    s.lastPageNum = currentPageNum;

    if (currentBvid) {
      hardResetForRoute(s, currentBvid);
    }
  }, 300);
}

export { emitInitialHandshake };
