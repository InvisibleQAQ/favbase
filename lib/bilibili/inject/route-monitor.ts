import { extractBvid, extractPageNum } from '../url-utils';
import type { InjectStateMachine } from './state';

export function startRouteMonitor(sm: InjectStateMachine): void {
  let lastBvid = extractBvid(location.href) ?? '';
  let lastPageNum = extractPageNum(location.href);

  setInterval(() => {
    const currentBvid = extractBvid(location.href) ?? '';
    const currentPageNum = extractPageNum(location.href);

    if (currentBvid === lastBvid && currentPageNum === lastPageNum) return;

    lastBvid = currentBvid;
    lastPageNum = currentPageNum;

    if (currentBvid) {
      sm.resetForRoute(currentBvid);
    }
  }, 300);
}
