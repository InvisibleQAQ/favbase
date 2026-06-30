import { extractBvid } from '../url-utils';
import { postBiliMessage } from '../messaging';
import type { RawSubtitleItem } from '../types';
import type { InjectEffects } from './state';

const STEALTH_STYLE_ID = '__favbase_stealth_css__';

function applyStealthMask(): void {
  if (document.getElementById(STEALTH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STEALTH_STYLE_ID;
  style.textContent =
    '.bpx-player-video-subtitle { visibility: hidden !important; }' +
    '.bpx-common-toast { display: none !important; }';
  document.head.appendChild(style);
}

function removeStealthMask(): void {
  document.getElementById(STEALTH_STYLE_ID)?.remove();
}

function hackSubtitleOff(): void {
  const stateNodes = document.querySelectorAll(
    '.bpx-player-ctrl-subtitle, .bpx-player-ctrl-subtitle-panel, .bilibili-player-video-btn-subtitle',
  );
  stateNodes.forEach((node) => {
    node.classList.remove(
      'active', 'on', 'show', 'open', 'opened',
      'is-active', 'bpx-state-active', 'bpx-state-show', 'bpx-state-opened',
    );
  });

  const containers = document.querySelectorAll(
    '.bpx-player-video-subtitle, .bili-subtitle, .bpx-player-subtitle-wrap, .bpx-player-subtitle',
  );
  containers.forEach((el) => {
    (el as HTMLElement).style.cssText = 'display: none !important; opacity: 0 !important;';
  });
}

function getCidFromPages(pages: unknown): number {
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return 0;
  let pageNum = 1;
  try {
    pageNum = Number(new URL(location.href).searchParams.get('p') || 1);
  } catch { /* use default 1 */ }
  const matched = list.find(
    (item: any) => Number(item?.page || 0) === pageNum,
  );
  return Number(matched?.cid || list[0]?.cid || 0);
}

export function resolvePageMeta(): { bvid: string; cid: number } {
  const state = (window as any).__INITIAL_STATE__ || {};
  const playInfo = (window as any).__playinfo__ || {};
  const bvidFromPath = extractBvid(location.href) ?? '';

  const bvid = String(
    state?.bvid ||
    state?.videoData?.bvid ||
    state?.videoData?.aidBvid ||
    playInfo?.data?.bvid ||
    bvidFromPath ||
    '',
  ).trim();

  const cid = Number(
    state?.videoData?.cid ||
    state?.cid ||
    state?.epInfo?.cid ||
    playInfo?.data?.cid ||
    getCidFromPages(state?.videoData?.pages) ||
    0,
  );

  return { bvid, cid: Number.isFinite(cid) ? cid : 0 };
}

function triggerCC(): boolean {
  applyStealthMask();

  const ccToggle = document.querySelector(
    '.bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle',
  );
  if (!ccToggle) return false;

  const allTextDivs = Array.from(
    document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item-text'),
  );
  const chineseTrack = allTextDivs.find((el) =>
    String((el as HTMLElement).innerText || '').trim().includes('中文'),
  );
  if (chineseTrack) {
    (chineseTrack as HTMLElement).click();
    return true;
  }

  const ccBtn = ccToggle as HTMLElement;
  try {
    ccBtn.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }),
    );
  } catch { /* ignore */ }
  ccBtn.click();

  setTimeout(() => {
    const retryTrack = Array.from(
      document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item-text'),
    ).find((el) =>
      String((el as HTMLElement).innerText || '').trim().includes('中文'),
    );
    if (retryTrack) (retryTrack as HTMLElement).click();
  }, 100);

  return true;
}

function checkPageMetaConsistency(): boolean {
  const state = (window as any).__INITIAL_STATE__ || {};
  const stateBvid = String(state?.bvid || state?.videoData?.bvid || '');
  const urlBvid = extractBvid(location.href) || '';
  if (!stateBvid || !urlBvid) return false;
  return stateBvid.toLowerCase() === urlBvid.toLowerCase();
}

export function createBrowserEffects(): InjectEffects {
  return {
    triggerCC,
    hideSubtitleDisplay: hackSubtitleOff,
    restoreDisplay: removeStealthMask,
    resolvePageMeta,
    isPageMetaConsistent: checkPageMetaConsistency,

    postRouteSwitch(bvid: string): void {
      postBiliMessage('BILI_ROUTE_SWITCH', { bvid });
    },

    postHandshake(bvid: string, cid: number): void {
      postBiliMessage('BILI_SUBTITLE_HANDSHAKE', { bvid, cid });
    },

    postSubtitleData(bvid: string, cid: number, body: unknown[]): void {
      postBiliMessage('BILI_SUBTITLE_DATA', { data: body as RawSubtitleItem[], bvid, cid }, { defer: true });
    },
  };
}
