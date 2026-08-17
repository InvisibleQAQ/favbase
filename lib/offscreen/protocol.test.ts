import { describe, expect, it } from 'vitest';

import {
  decodeOffscreenRequest,
  decodeOffscreenResponse,
  OFFSCREEN_PROTOCOL_CHANNEL,
  OFFSCREEN_PROTOCOL_VERSION,
} from './protocol';

describe('Offscreen runtime protocol', () => {
  it('rejects malformed chunk preparation requests', () => {
    expect(decodeOffscreenRequest({
      type: 'OFFSCREEN_CHUNK_PREPARE',
      sessionId: 'chunk-session',
      audioUrl: { forged: true },
      maxBytes: 1_000,
    })).toBeNull();
  });

  it.each([
    { type: 'OFFSCREEN_STATUS' },
    {
      type: 'OFFSCREEN_CHUNK_PREPARE',
      sessionId: 'chunk-session',
      audioUrl: 'https://example.com/audio',
      maxBytes: 1_000,
    },
    {
      type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
      sessionId: 'chunk-session',
      apiKey: 'secret',
      model: 'model',
      title: 'Protocol test',
      baseUrl: 'https://example.com/v1',
    },
    { type: 'OFFSCREEN_CHUNK_RELEASE', sessionId: 'chunk-session' },
  ])('accepts legacy $type requests', (request) => {
    expect(decodeOffscreenRequest(request)).toMatchObject(request);
  });

  it('accepts the versioned request envelope', () => {
    expect(decodeOffscreenRequest({
      type: 'OFFSCREEN_STATUS',
      channel: OFFSCREEN_PROTOCOL_CHANNEL,
      protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
    })).toMatchObject({
      type: 'OFFSCREEN_STATUS',
      channel: OFFSCREEN_PROTOCOL_CHANNEL,
      protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
    });
  });

  it('accepts nullable-free and failure response variants by request type', () => {
    expect(decodeOffscreenResponse('OFFSCREEN_STATUS', {
      ffmpeg: 'ready',
      pglite: 'pending',
    }).ok).toBe(true);
    expect(decodeOffscreenResponse('OFFSCREEN_CHUNK_PREPARE', {
      success: false,
      error: { code: 'ASR_UNKNOWN', message: 'failed' },
    }).ok).toBe(true);
    expect(decodeOffscreenResponse('OFFSCREEN_CHUNK_TRANSCRIBE', {
      success: true,
      rows: [{ start: 0, end: 1, text: 'line' }],
    }).ok).toBe(true);
    expect(decodeOffscreenResponse('OFFSCREEN_CHUNK_RELEASE', { success: true }).ok).toBe(true);
  });
});
