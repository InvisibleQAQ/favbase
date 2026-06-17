import { extractBvid } from '../video-info';
import type { InjectState } from './state';
import { stopAutoTriggerFlow, hackSubtitleOff, scheduleVisualRestore } from './cc-trigger';

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

export function isSubtitleRequest(rawUrl: string): boolean {
  if (!rawUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, location.href);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === 'data.bilibili.com') return false;
  if (path.includes('/log/web')) return false;
  if (/\/bfs\/(ai_)?subtitle\//i.test(path)) return true;
  if (/\/aisubtitle\//i.test(path)) return true;
  if (path.endsWith('.json') && path.includes('subtitle')) return true;
  return false;
}

export function postSubtitleData(s: InjectState, body: unknown[]): void {
  const meta = resolvePageMeta();
  const routeBvid = extractBvid(location.href) ?? '';
  const bvid = String(meta.bvid || routeBvid || '').trim();
  if (!bvid) return;

  const cid = meta.cid || 0;

  window.postMessage(
    { type: 'BILI_SUBTITLE_HANDSHAKE', bvid, cid },
    '*',
  );
  setTimeout(() => {
    window.postMessage(
      { type: 'BILI_SUBTITLE_DATA', data: body, bvid, cid },
      '*',
    );
  }, 0);
}

function emitSubtitlePayload(s: InjectState, rawText: string, _url: string, gen?: number): void {
  if (s.isSubtitleCaptured) return;
  if (gen !== undefined && gen !== s.routeGeneration) return;

  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    return;
  }

  const body =
    data?.body ||
    data?.data?.body ||
    data?.content ||
    data?.result?.body ||
    (Array.isArray(data) ? data : null);

  if (!Array.isArray(body) || !body.length) return;

  s.isSubtitleCaptured = true;
  s.capturedBvid = extractBvid(location.href) ?? s.capturedBvid;
  s.cachedSubtitleBody = body;
  stopAutoTriggerFlow(s);
  hackSubtitleOff();

  postSubtitleData(s, body);
  scheduleVisualRestore(s, 3000);
}

export function installInterceptors(s: InjectState): void {
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : (args[0] as Request)?.url || '';
    const response = await s.originalFetch.apply(this, args);

    if (isSubtitleRequest(url)) {
      const gen = s.routeGeneration;
      response
        .clone()
        .text()
        .then((text) => emitSubtitlePayload(s, text, url, gen))
        .catch(() => {});
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    (this as any).__biliUrl = String(url || '');
    return s.originalXhrOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const url: string = (this as any).__biliUrl || '';

    if (isSubtitleRequest(url)) {
      const gen = s.routeGeneration;
      this.addEventListener('load', () => {
        emitSubtitlePayload(s, this.responseText, url, gen);
      });
    }

    return s.originalXhrSend.call(this, body);
  };
}
