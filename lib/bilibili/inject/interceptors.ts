import type { InjectStateMachine } from './state';
import { isSubtitleCdnUrl } from '../api';

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

    if (isSubtitleCdnUrl(url)) {
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

    if (isSubtitleCdnUrl(url)) {
      const gen = sm.generation;
      this.addEventListener('load', () => {
        sm.markCaptured(gen, this.responseText, location.href);
      });
    }

    return originalXhrSend.call(this, body);
  };
}
