import { describe, expect, it, vi } from 'vitest';

import { handleFetchBookmarkPage } from './bookmark-handlers';

describe('handleFetchBookmarkPage', () => {
  it('rejects private URLs at the background message boundary without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(handleFetchBookmarkPage({
      type: 'FETCH_BOOKMARK_PAGE',
      url: 'http://127.0.0.1/admin',
    })).resolves.toEqual({ kind: 'permanent', reason: 'invalid-url' });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
