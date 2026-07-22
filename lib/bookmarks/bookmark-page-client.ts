import { browser } from 'wxt/browser';

import type { FetchPageResult } from './bookmark-page-fetch';

function isFetchPageResult(value: unknown): value is FetchPageResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as { kind?: unknown; html?: unknown; reason?: unknown };
  if (result.kind === 'ok') return typeof result.html === 'string';
  if (result.kind === 'permanent') {
    return ['invalid-url', 'http-4xx', 'not-html', 'too-large'].includes(String(result.reason));
  }
  return result.kind === 'transient'
    && ['http-5xx', 'http-429', 'timeout', 'network'].includes(String(result.reason));
}

export async function fetchBookmarkPageInBackground(url: string): Promise<FetchPageResult> {
  const result: unknown = await browser.runtime.sendMessage({
    type: 'FETCH_BOOKMARK_PAGE',
    url,
  });
  if (!isFetchPageResult(result)) {
    return { kind: 'transient', reason: 'network' };
  }
  return result;
}
