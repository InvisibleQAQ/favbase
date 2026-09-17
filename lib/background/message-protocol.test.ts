import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_MESSAGE_TYPES,
  BACKGROUND_PROTOCOL_CHANNEL,
  BACKGROUND_PROTOCOL_VERSION,
  MAX_RUNTIME_SUBTITLE_ROWS,
  decodeBackgroundMessage,
  decodeBackgroundResponse,
} from './message-protocol';
import {
  OFFSCREEN_PROTOCOL_CHANNEL,
  OFFSCREEN_PROTOCOL_VERSION,
} from '@/lib/offscreen/protocol';

const validMessages = [
  {
    type: 'TRANSCRIBE_AUDIO',
    platform: 'bilibili',
    videoId: 'BV1protocol',
    cid: 42,
    title: 'Protocol test',
  },
  { type: 'TRANSCRIBE_ABORT', videoId: 'BV1protocol' },
  { type: 'GET_VIDEO_CACHE', platform: 'bilibili', videoId: 'BV1protocol' },
  {
    type: 'CACHE_SUBTITLE',
    platform: 'bilibili',
    videoId: 'BV1protocol',
    rows: [{ start: 0, end: 1, text: 'line' }],
    source: 'official',
  },
  {
    type: 'SUMMARIZE_VIDEO',
    platform: 'bilibili',
    videoId: 'BV1protocol',
    title: 'Protocol test',
    force: true,
  },
  { type: 'SUMMARIZE_ABORT', videoId: 'BV1protocol' },
  { type: 'GET_SUMMARY_CACHE', platform: 'bilibili', videoId: 'BV1protocol' },
  { type: 'OPEN_APP_PAGE', hash: '#/settings' },
  { type: 'FETCH_BOOKMARK_PAGE', url: 'https://example.com/article' },
  { type: 'AGENT_BRIDGE_CONNECT_NOW' },
  { type: 'WEBDAV_SYNC_NOW' },
  { type: 'WEBDAV_CLEAR_REMOTE' },
  {
    type: 'OFFSCREEN_CHUNK_PROGRESS',
    sessionId: 'chunk-session',
    chunkIndex: 0,
    totalChunks: 2,
  },
] as const;

describe('Background runtime message protocol', () => {
  it('rejects a known message type with an invalid payload', () => {
    expect(decodeBackgroundMessage({
      type: 'TRANSCRIBE_AUDIO',
      platform: 'bilibili',
      videoId: 42,
      title: 'Protocol test',
    })).toBeNull();
  });

  it.each(validMessages)('decodes legacy $type messages', (message) => {
    expect(decodeBackgroundMessage(message)).toMatchObject(message);
  });

  it('decodes versioned messages without breaking the legacy wire shape', () => {
    const message = {
      type: 'WEBDAV_SYNC_NOW',
      channel: BACKGROUND_PROTOCOL_CHANNEL,
      protocolVersion: BACKGROUND_PROTOCOL_VERSION,
    } as const;

    expect(decodeBackgroundMessage(message)).toMatchObject(message);
  });

  it('accepts the Offscreen-owned envelope on progress messages', () => {
    const message = {
      type: 'OFFSCREEN_CHUNK_PROGRESS',
      sessionId: 'chunk-session',
      chunkIndex: 0,
      totalChunks: 2,
      channel: OFFSCREEN_PROTOCOL_CHANNEL,
      protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
    } as const;

    expect(decodeBackgroundMessage(message)).toMatchObject(message);
  });

  it('keeps the runtime registry complete with the declared message union', () => {
    expect(BACKGROUND_MESSAGE_TYPES).toEqual(validMessages.map((message) => message.type));
  });

  it.each([
    ['unknown type', { type: 'UNKNOWN_MESSAGE' }],
    [
      'non-finite subtitle timestamp',
      {
        type: 'CACHE_SUBTITLE',
        platform: 'bilibili',
        videoId: 'BV1protocol',
        rows: [{ start: Number.NaN, end: 1, text: 'line' }],
        source: 'official',
      },
    ],
    [
      'oversized subtitle rows',
      {
        type: 'CACHE_SUBTITLE',
        platform: 'bilibili',
        videoId: 'BV1protocol',
        rows: Array.from(
          { length: MAX_RUNTIME_SUBTITLE_ROWS + 1 },
          () => ({ start: 0, end: 1, text: 'line' }),
        ),
        source: 'official',
      },
    ],
  ])('rejects %s', (_case, message) => {
    expect(decodeBackgroundMessage(message)).toBeNull();
  });
});

describe('TRANSCRIBE_AUDIO response contract', () => {
  const rows = [{ start: 0, end: 1, text: 'line' }];

  it('rejects a success response that does not name the video it belongs to', () => {
    expect(decodeBackgroundResponse('TRANSCRIBE_AUDIO', {
      success: true,
      data: { rows, source: 'official', cached: false },
    })).toEqual({ ok: false });
  });

  it('carries the video id across the wire byte-exact', () => {
    // Case matters: BV is base58, so the wire must not fold it. The consumer's
    // persistence gate compares byte-exact and would break on any normalizing.
    const decoded = decodeBackgroundResponse('TRANSCRIBE_AUDIO', {
      success: true,
      data: { videoId: 'BV1XN416DEeR', rows, source: 'official', cached: false },
    });

    expect(decoded).toEqual({
      ok: true,
      value: {
        success: true,
        data: { videoId: 'BV1XN416DEeR', rows, source: 'official', cached: false },
      },
    });
  });

  it('keeps carrying the mismatch refusal as a typed transcription error', () => {
    expect(decodeBackgroundResponse('TRANSCRIBE_AUDIO', {
      success: false,
      error: {
        code: 'TRANSCRIBE_VIDEO_ID_MISMATCH',
        message: 'Transcript for BV_other was returned for BV_self',
        params: { requested: 'BV_self', received: 'BV_other' },
      },
    }).ok).toBe(true);
  });
});
