import type { FetchBookmarkPageRequest } from './messages';
import { classifyUrl, fetchBookmarkPage } from '@/lib/bookmarks/bookmark-page-fetch';

export function handleFetchBookmarkPage(msg: FetchBookmarkPageRequest) {
  if (!classifyUrl(msg.url)) {
    return Promise.resolve({ kind: 'permanent' as const, reason: 'invalid-url' as const });
  }
  return fetchBookmarkPage(msg.url);
}
