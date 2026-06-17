import type { InjectStateMachine } from './state';

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

export function installInterceptors(sm: InjectStateMachine): void {
  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : (args[0] as Request)?.url || '';
    const response = await originalFetch.apply(this, args);

    if (isSubtitleRequest(url)) {
      const gen = sm.generation;
      response
        .clone()
        .text()
        .then((text) => sm.markCaptured(gen, text, location.href))
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
      const gen = sm.generation;
      this.addEventListener('load', () => {
        sm.markCaptured(gen, this.responseText, location.href);
      });
    }

    return originalXhrSend.call(this, body);
  };
}
