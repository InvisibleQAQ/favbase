import { describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('@/lib/background/client', () => ({
  sendBackgroundMessage: sendMessage,
}));

import { fetchBookmarkPageInBackground } from './bookmark-page-client';

describe('fetchBookmarkPageInBackground', () => {
  it('delegates arbitrary-site fetching to the background context', async () => {
    const result = { kind: 'ok' as const, html: '<article>safe</article>' };
    sendMessage.mockResolvedValueOnce(result);
    const ambientFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('app.html must not fetch third-party bookmark pages'),
    );

    await expect(fetchBookmarkPageInBackground('https://example.com/article')).resolves.toEqual(result);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'FETCH_BOOKMARK_PAGE',
      url: 'https://example.com/article',
    });
    expect(ambientFetch).not.toHaveBeenCalled();

    ambientFetch.mockRestore();
  });
});
