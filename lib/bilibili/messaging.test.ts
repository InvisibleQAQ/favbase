import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_BILI_SUBTITLE_ITEMS,
  MAX_BILI_SUBTITLE_TEXT_CHARS,
  onBiliMessage,
  postBiliMessage,
} from './messaging';

describe('Bilibili page message protocol', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.restoreAllMocks();
  });

  it('delivers valid messages without changing the existing payload shape', () => {
    const callback = vi.fn();
    cleanups.push(onBiliMessage('BILI_SUBTITLE_HANDSHAKE', callback));

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: 'BILI_SUBTITLE_HANDSHAKE', bvid: 'BV1protocol', cid: 42 },
    }));

    expect(callback).toHaveBeenCalledWith({
      type: 'BILI_SUBTITLE_HANDSHAKE',
      bvid: 'BV1protocol',
      cid: 42,
    });
  });

  it.each([
    ['missing fields', { type: 'BILI_SUBTITLE_DATA', bvid: 'BV1protocol' }],
    [
      'non-array subtitles',
      { type: 'BILI_SUBTITLE_DATA', bvid: 'BV1protocol', cid: 42, data: {} },
    ],
    [
      'malformed subtitle rows',
      {
        type: 'BILI_SUBTITLE_DATA',
        bvid: 'BV1protocol',
        cid: 42,
        data: [{ from: 0, to: 1, content: { forged: true } }],
      },
    ],
    [
      'oversized subtitle arrays',
      {
        type: 'BILI_SUBTITLE_DATA',
        bvid: 'BV1protocol',
        cid: 42,
        data: Array.from(
          { length: MAX_BILI_SUBTITLE_ITEMS + 1 },
          () => ({ from: 0, to: 1, content: 'line' }),
        ),
      },
    ],
    [
      'subtitle payloads over the aggregate text budget',
      {
        type: 'BILI_SUBTITLE_DATA',
        bvid: 'BV1protocol',
        cid: 42,
        data: Array.from(
          { length: Math.floor(MAX_BILI_SUBTITLE_TEXT_CHARS / 10_000) + 1 },
          () => ({ from: 0, to: 1, content: 'x'.repeat(10_000) }),
        ),
      },
    ],
  ])('rejects %s at the page message seam', (_case, data) => {
    const callback = vi.fn();
    cleanups.push(onBiliMessage('BILI_SUBTITLE_DATA', callback));

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data,
    }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores messages from a different source and unknown message types', () => {
    const callback = vi.fn();
    cleanups.push(onBiliMessage('BILI_ROUTE_SWITCH', callback));

    window.dispatchEvent(new MessageEvent('message', {
      source: null,
      data: { type: 'BILI_ROUTE_SWITCH', bvid: 'BV1wrong-source' },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { type: 'BILI_UNKNOWN', bvid: 'BV1unknown' },
    }));

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not post malformed payloads from the Main World adapter', () => {
    const postMessage = vi.spyOn(window, 'postMessage');

    postBiliMessage('BILI_SUBTITLE_DATA', {
      bvid: 'BV1protocol',
      cid: 42,
      data: [{ from: 0, to: 1, content: 99 }] as never,
    });

    expect(postMessage).not.toHaveBeenCalled();
  });
});
