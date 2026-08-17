import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundContext } from './types';
import { dispatchBackgroundMessage } from './dispatcher';

const tabsQuery = vi.fn();
const route = vi.fn();

describe('Background message dispatcher', () => {
  beforeEach(() => {
    vi.stubGlobal('browser', {
      runtime: {
        id: 'favbase-test',
        getURL: (path: string) => `chrome-extension://favbase-test${path}`,
      },
      tabs: {
        query: tabsQuery,
        create: vi.fn(),
        update: vi.fn(),
      },
      windows: { update: vi.fn() },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects invalid payloads before routing to a handler', () => {
    const result = dispatchBackgroundMessage(
      { type: 'OPEN_APP_PAGE', hash: 42 },
      { id: 'favbase-test' },
      {} as BackgroundContext,
      route,
    );

    expect(result).toBeUndefined();
    expect(route).not.toHaveBeenCalled();
    expect(tabsQuery).not.toHaveBeenCalled();
  });

  it('rejects messages sent by a different extension identity', () => {
    dispatchBackgroundMessage(
      { type: 'WEBDAV_SYNC_NOW' },
      { id: 'another-extension' },
      {} as BackgroundContext,
      route,
    );

    expect(route).not.toHaveBeenCalled();
  });

  it('accepts offscreen progress only from the offscreen document', () => {
    const message = {
      type: 'OFFSCREEN_CHUNK_PROGRESS',
      sessionId: 'chunk-session',
      chunkIndex: 0,
      totalChunks: 2,
    };

    dispatchBackgroundMessage(
      message,
      {
        id: 'favbase-test',
        url: 'chrome-extension://favbase-test/app.html',
      },
      {} as BackgroundContext,
      route,
    );

    expect(route).not.toHaveBeenCalled();
  });

  it('routes a valid message from this extension', () => {
    const message = { type: 'WEBDAV_SYNC_NOW' };

    dispatchBackgroundMessage(
      message,
      { id: 'favbase-test', url: 'chrome-extension://favbase-test/app.html' },
      {} as BackgroundContext,
      route,
    );

    expect(route).toHaveBeenCalledWith(
      message,
      { id: 'favbase-test', url: 'chrome-extension://favbase-test/app.html' },
      {},
    );
  });

  it('preserves handler rejections for the runtime caller', async () => {
    route.mockRejectedValueOnce(new Error('handler failed'));

    const result = dispatchBackgroundMessage(
      { type: 'WEBDAV_SYNC_NOW' },
      { id: 'favbase-test' },
      {} as BackgroundContext,
      route,
    );

    await expect(result).rejects.toThrow('handler failed');
  });
});
