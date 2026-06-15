/**
 * Main-world content script for Bilibili video pages.
 *
 * Runs in the page's JS context (world: 'MAIN') so it can:
 * 1. Read window.__INITIAL_STATE__ / __playinfo__ for CID (R1)
 * 2. Intercept fetch / XHR to passively capture subtitle data (R4)
 * 3. Auto-trigger the CC button so the player loads subtitles (R4)
 * 4. Bridge data to the isolated content script via postMessage
 *
 * Ported from Bilitato inject.js, stripped to the subtitle-capture essentials.
 */
export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    // Guard against duplicate injection
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

    /**
     * Read bvid + cid from page globals (__INITIAL_STATE__, __playinfo__).
     */
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
      // Emit data on next microtask so HANDSHAKE arrives first
      setTimeout(() => {
        window.postMessage(
          { type: 'BILI_SUBTITLE_DATA', data: body, bvid, cid },
          '*',
        );
      }, 0);
    }

    function emitSubtitlePayload(rawText: string, _url: string): void {
      if (isSubtitleCaptured) return;

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
      stopAutoTriggerFlow();

      postSubtitleData(body);
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
        response
          .clone()
          .text()
          .then((text) => emitSubtitlePayload(text, url))
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
        this.addEventListener('load', () => {
          emitSubtitlePayload(this.responseText, url);
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

      // Try clicking the Chinese track item directly
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

      // Fallback: click the CC button itself
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

      // Retry after panel opens
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
      if (isSubtitleCaptured || autoTriggerStarted) return;
      if (autoTriggerTimer) clearTimeout(autoTriggerTimer);
      autoTriggerAttempts = 0;
      // Wait 2s for the player to initialize before trying
      autoTriggerTimer = setTimeout(autoTriggerLoop, 2000);
    }

    // -----------------------------------------------------------------------
    // Bootstrap: emit handshake + start auto-trigger
    // -----------------------------------------------------------------------

    // Emit initial handshake once page state is likely available
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

    // __INITIAL_STATE__ is typically set after DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        emitInitialHandshake();
        scheduleAutoTriggerFlow();
      });
    } else {
      emitInitialHandshake();
      scheduleAutoTriggerFlow();
    }
  },
});
