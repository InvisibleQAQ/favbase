import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchOffscreenMessage } from './dispatcher';

describe('Offscreen message dispatcher', () => {
  const deps = {
    getFfmpegState: vi.fn(() => 'ready' as const),
    getPgliteState: vi.fn(() => 'ready' as const),
    prepare: vi.fn(),
    transcribe: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'favbase-test',
        getURL: (path: string) => `chrome-extension://favbase-test${path}`,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects malformed requests before calling a subsystem', () => {
    const sendResponse = vi.fn();
    const handled = dispatchOffscreenMessage(
      {
        type: 'OFFSCREEN_CHUNK_PREPARE',
        sessionId: 'chunk-session',
        audioUrl: { forged: true },
        maxBytes: 1_000,
      },
      { id: 'favbase-test' },
      sendResponse,
      deps,
    );

    expect(handled).toBe(false);
    expect(deps.prepare).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('answers status synchronously without claiming an async response', () => {
    const sendResponse = vi.fn();
    const handled = dispatchOffscreenMessage(
      { type: 'OFFSCREEN_STATUS' },
      { id: 'favbase-test' },
      sendResponse,
      deps,
    );

    expect(handled).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({ ffmpeg: 'ready', pglite: 'ready' });
  });

  it('keeps the async response channel open for preparation', async () => {
    deps.prepare.mockResolvedValueOnce(undefined);
    const sendResponse = vi.fn();
    const handled = dispatchOffscreenMessage(
      {
        type: 'OFFSCREEN_CHUNK_PREPARE',
        sessionId: 'chunk-session',
        audioUrl: 'https://example.com/audio',
        maxBytes: 1_000,
      },
      { id: 'favbase-test' },
      sendResponse,
      deps,
    );

    expect(handled).toBe(true);
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('normalizes rejected transcriptions to the existing error wire shape', async () => {
    deps.transcribe.mockRejectedValueOnce(new Error('ffmpeg failed'));
    const sendResponse = vi.fn();
    const handled = dispatchOffscreenMessage(
      {
        type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
        sessionId: 'chunk-session',
        apiKey: 'secret',
        model: 'model',
        title: 'Protocol test',
        baseUrl: 'https://example.com/v1',
      },
      { id: 'favbase-test' },
      sendResponse,
      deps,
    );

    expect(handled).toBe(true);
    await Promise.resolve();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: { code: 'ASR_UNKNOWN', message: 'ffmpeg failed' },
    });
  });

  it('rejects requests from another extension identity', () => {
    const sendResponse = vi.fn();
    const handled = dispatchOffscreenMessage(
      { type: 'OFFSCREEN_STATUS' },
      { id: 'another-extension' },
      sendResponse,
      deps,
    );

    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
