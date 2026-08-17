import type { FetchPageResult } from './bookmark-page-fetch';
import { sendBackgroundMessage } from '@/lib/background/client';

export async function fetchBookmarkPageInBackground(url: string): Promise<FetchPageResult> {
  try {
    return await sendBackgroundMessage({ type: 'FETCH_BOOKMARK_PAGE', url });
  } catch {
    return { kind: 'transient', reason: 'network' };
  }
}
