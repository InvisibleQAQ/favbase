import { afterEach, describe, expect, it, vi } from 'vitest';

import { OffscreenProtocolError, sendOffscreenMessage } from './client';

describe('Offscreen typed client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed transcribe responses', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true, rows: [{ text: 42 }] }),
      },
    });

    const request = sendOffscreenMessage({
      type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
      sessionId: 'chunk-session',
      apiKey: 'secret',
      model: 'model',
      title: 'Protocol test',
      baseUrl: 'https://example.com/v1',
    });

    await expect(request).rejects.toBeInstanceOf(OffscreenProtocolError);
  });
});
