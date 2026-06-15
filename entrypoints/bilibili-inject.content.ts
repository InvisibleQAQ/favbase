/**
 * Main-world content script for Bilibili video pages.
 *
 * Runs in the page's JS context (world: 'MAIN') so it can:
 * 1. Read window.__INITIAL_STATE__ / __playinfo__ for CID
 * 2. Intercept fetch / XHR to passively capture subtitle data
 * 3. Auto-trigger the CC button so the player loads subtitles
 * 4. Bridge data to the isolated content script via postMessage
 * 5. Periodically re-emit cached data for late-mounting content scripts
 * 6. Monitor SPA route changes and reset state accordingly
 */
export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    if ((window as any).__FAVBASE_INJECT_READY__) return;
    (window as any).__FAVBASE_INJECT_READY__ = true;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    let isSubtitleCaptured = false;
    let autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;
    let autoTriggerStarted = false;
    let autoTriggerAttempts = 0;
    let capturedBvid = '';
    let cachedSubtitleBody: unknown[] | null = null;
    let routeGeneration = 0; // incremented on each SPA route change

    // SPA route monitoring state
    let routeResolveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastBvid = '';
    let lastPageNum = 1;

    // Periodic re-emission state
    let reemitTimer: ReturnType<typeof setInterval> | null = null;

    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function getBvidFromUrl(url: string): string {
      const match = String(url || '').match(/\/video\/(BV[0-9A-Za-z]+)/i);
      return match ? match[1] : '';
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

    function resolvePageMeta(): { bvid: string; cid: number } {
      const state = (window as any).__INITIAL_STATE__ || {};
      const playInfo = (window as any).__playinfo__ || {};
      const bvidFromPath = getBvidFromUrl(location.href);

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

    function getPageNumFromUrl(): number {
      try {
        return Number(new URL(location.href).searchParams.get('p') || 1);
      } catch {
        return 1;
      }
    }

    // -----------------------------------------------------------------------
    // Stealth CSS — hide subtitle display while auto-triggering CC button
    // -----------------------------------------------------------------------

    const STEALTH_STYLE_ID = '__favbase_stealth_css__';
    let stealthRestoreTimer: ReturnType<typeof setTimeout> | null = null;

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

    function scheduleVisualRestore(delayMs: number): void {
      if (stealthRestoreTimer) clearTimeout(stealthRestoreTimer);
      stealthRestoreTimer = setTimeout(() => {
        removeStealthMask();
        stealthRestoreTimer = null;
      }, delayMs);
    }

    // -----------------------------------------------------------------------
    // Subtitle request detection
    // -----------------------------------------------------------------------

    function isSubtitleRequest(rawUrl: string): boolean {
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

    // -----------------------------------------------------------------------
    // Subtitle data emission
    // -----------------------------------------------------------------------

    function postSubtitleData(body: unknown[]): void {
      const meta = resolvePageMeta();
      const routeBvid = getBvidFromUrl(location.href);
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

    function emitSubtitlePayload(rawText: string, _url: string, gen?: number): void {
      if (isSubtitleCaptured) return;
      // Stale response from a previous route — discard
      if (gen !== undefined && gen !== routeGeneration) return;

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

      isSubtitleCaptured = true;
      capturedBvid = getBvidFromUrl(location.href) || capturedBvid;
      cachedSubtitleBody = body;
      stopAutoTriggerFlow();
      hackSubtitleOff();

      postSubtitleData(body);
      scheduleVisualRestore(3000);
    }

    // -----------------------------------------------------------------------
    // Fetch / XHR interception
    // -----------------------------------------------------------------------

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const url =
        typeof args[0] === 'string'
          ? args[0]
          : (args[0] as Request)?.url || '';
      const response = await originalFetch.apply(this, args);

      if (isSubtitleRequest(url)) {
        const gen = routeGeneration;
        response
          .clone()
          .text()
          .then((text) => emitSubtitlePayload(text, url, gen))
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
      return originalXhrOpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const url: string = (this as any).__biliUrl || '';

      if (isSubtitleRequest(url)) {
        const gen = routeGeneration;
        this.addEventListener('load', () => {
          emitSubtitlePayload(this.responseText, url, gen);
        });
      }

      return originalXhrSend.call(this, body);
    };

    // -----------------------------------------------------------------------
    // Auto-trigger: click the CC button so the player fetches subtitles
    // -----------------------------------------------------------------------

    function stopAutoTriggerFlow(): void {
      if (autoTriggerTimer) {
        clearTimeout(autoTriggerTimer);
        autoTriggerTimer = null;
      }
    }

    function blindSilentOpen(): boolean {
      if (isSubtitleCaptured) return false;
      applyStealthMask();

      const allTextDivs = Array.from(
        document.querySelectorAll(
          '.bpx-player-ctrl-subtitle-language-item-text',
        ),
      );
      const chineseTrack = allTextDivs.find((el) =>
        String((el as HTMLElement).innerText || '')
          .trim()
          .includes('中文'),
      );
      if (chineseTrack) {
        (chineseTrack as HTMLElement).click();
        return true;
      }

      const ccBtn = document.querySelector(
        '.bpx-player-ctrl-subtitle',
      ) as HTMLElement | null;
      let clicked = false;
      if (ccBtn) {
        try {
          ccBtn.dispatchEvent(
            new MouseEvent('mouseenter', {
              bubbles: true,
              cancelable: true,
              view: window,
            }),
          );
        } catch { /* ignore */ }
        ccBtn.click();
        clicked = true;
      }

      setTimeout(() => {
        if (isSubtitleCaptured) return;
        const retryTrack = Array.from(
          document.querySelectorAll(
            '.bpx-player-ctrl-subtitle-language-item-text',
          ),
        ).find((el) =>
          String((el as HTMLElement).innerText || '')
            .trim()
            .includes('中文'),
        );
        if (retryTrack) (retryTrack as HTMLElement).click();
      }, 100);

      return clicked;
    }

    function autoTriggerLoop(): void {
      if (isSubtitleCaptured) return;

      const toggle = document.querySelector(
        '.bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle',
      );
      if (!toggle) {
        autoTriggerAttempts += 1;
        if (autoTriggerAttempts >= 10) return;
        autoTriggerTimer = setTimeout(autoTriggerLoop, 1000);
        return;
      }

      autoTriggerStarted = true;
      blindSilentOpen();
    }

    function scheduleAutoTriggerFlow(): void {
      if (isSubtitleCaptured) return;
      stopAutoTriggerFlow();
      autoTriggerStarted = false;
      autoTriggerAttempts = 0;
      autoTriggerTimer = setTimeout(autoTriggerLoop, 2000);
    }

    // -----------------------------------------------------------------------
    // Periodic re-emission — ensures late-mounting content scripts receive data
    // -----------------------------------------------------------------------

    function startReemitLoop(): void {
      stopReemitLoop();
      let ticks = 0;
      reemitTimer = setInterval(() => {
        ticks++;
        if (ticks > 10) {
          stopReemitLoop();
          return;
        }
        if (isSubtitleCaptured && cachedSubtitleBody) {
          postSubtitleData(cachedSubtitleBody);
        } else {
          emitInitialHandshake();
        }
      }, 1000);
    }

    function stopReemitLoop(): void {
      if (reemitTimer) {
        clearInterval(reemitTimer);
        reemitTimer = null;
      }
    }

    // -----------------------------------------------------------------------
    // SPA route monitoring
    // -----------------------------------------------------------------------

    function hardResetForRoute(newBvid: string): void {
      routeGeneration++;
      isSubtitleCaptured = false;
      autoTriggerStarted = false;
      autoTriggerAttempts = 0;
      capturedBvid = newBvid;
      cachedSubtitleBody = null;
      stopAutoTriggerFlow();
      stopReemitLoop();
      if (stealthRestoreTimer) {
        clearTimeout(stealthRestoreTimer);
        stealthRestoreTimer = null;
      }
      removeStealthMask();
      if (routeResolveTimer) clearTimeout(routeResolveTimer);

      window.postMessage({ type: 'BILI_ROUTE_SWITCH', bvid: newBvid }, '*');

      routeResolveTimer = setTimeout(() => {
        emitInitialHandshake();
        scheduleAutoTriggerFlow();
        startReemitLoop();
      }, 800);
    }

    function startRouteMonitor(): void {
      lastBvid = getBvidFromUrl(location.href);
      lastPageNum = getPageNumFromUrl();

      setInterval(() => {
        const currentBvid = getBvidFromUrl(location.href);
        const currentPageNum = getPageNumFromUrl();

        if (currentBvid === lastBvid && currentPageNum === lastPageNum) return;

        lastBvid = currentBvid;
        lastPageNum = currentPageNum;

        if (currentBvid) {
          hardResetForRoute(currentBvid);
        }
      }, 300);
    }

    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------

    function emitInitialHandshake(): void {
      const meta = resolvePageMeta();
      if (meta.bvid) {
        capturedBvid = meta.bvid;
        window.postMessage(
          { type: 'BILI_SUBTITLE_HANDSHAKE', bvid: meta.bvid, cid: meta.cid },
          '*',
        );
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        emitInitialHandshake();
        scheduleAutoTriggerFlow();
        startRouteMonitor();
        startReemitLoop();
      });
    } else {
      emitInitialHandshake();
      scheduleAutoTriggerFlow();
      startRouteMonitor();
      startReemitLoop();
    }
  },
});
