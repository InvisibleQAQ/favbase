import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackgroundProtocolError,
  onBackgroundPush,
  sendBackgroundMessage,
} from './client';

describe('Background typed client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed responses before callers can consume them', async () => {
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      },
    });

    const request = sendBackgroundMessage({
      type: 'TRANSCRIBE_AUDIO',
      platform: 'bilibili',
      videoId: 'BV1protocol',
      title: 'Protocol test',
    });

    await expect(request).rejects.toBeInstanceOf(BackgroundProtocolError);
  });

  it('encodes requests and returns a validated response', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      success: true,
      data: {
        rows: [{ start: 0, end: 1, text: 'line' }],
        source: 'official',
        cached: false,
      },
    });
    vi.stubGlobal('browser', { runtime: { sendMessage } });

    const result = await sendBackgroundMessage({
      type: 'TRANSCRIBE_AUDIO',
      platform: 'bilibili',
      videoId: 'BV1protocol',
      title: 'Protocol test',
    });

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'TRANSCRIBE_AUDIO',
      channel: 'favbase-background',
      protocolVersion: 1,
    }));
  });

  it('validates the Agent Bridge immediate-connect acknowledgement', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('browser', { runtime: { sendMessage } });

    await expect(sendBackgroundMessage({
      type: 'AGENT_BRIDGE_CONNECT_NOW',
    })).resolves.toEqual({ success: true });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'AGENT_BRIDGE_CONNECT_NOW',
      channel: 'favbase-background',
      protocolVersion: 1,
    }));
  });

  it.each([undefined, null, {}, { success: false }])(
    'rejects an invalid Agent Bridge acknowledgement represented as %s',
    async (response) => {
      vi.stubGlobal('browser', {
        runtime: { sendMessage: vi.fn().mockResolvedValue(response) },
      });

      await expect(sendBackgroundMessage({
        type: 'AGENT_BRIDGE_CONNECT_NOW',
      })).rejects.toBeInstanceOf(BackgroundProtocolError);
    },
  );

  it('ignores malformed push messages before subscriber callbacks', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal('browser', {
      runtime: { onMessage: { addListener, removeListener } },
    });
    const callback = vi.fn();
    const cleanup = onBackgroundPush('TRANSCRIBE_STATUS', callback);
    const handler = addListener.mock.calls[0][0] as (message: unknown) => void;

    handler({ type: 'TRANSCRIBE_STATUS', videoId: 42, progress: 10, stage: 'start' });

    expect(callback).not.toHaveBeenCalled();
    cleanup();
    expect(removeListener).toHaveBeenCalledWith(handler);
  });
});
