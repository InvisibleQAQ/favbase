import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OffscreenPrepareRequest, OffscreenTranscribeRequest } from './types';

// Wiring of the chunk-resume table (docs/38) into the FFmpeg subsystem. The
// boundary is faked: FFmpeg (chunk N's bytes are `[N, <first audio byte>]`),
// the audio download, the duration probe, the progress push and the ASR
// client. Chunk planning, the session map, hashing, the progress table and
// the merge are real.
const h = vi.hoisted(() => ({
  requestGroqTranscription: vi.fn(),
  sendOffscreenProgress: vi.fn(),
  /** What the fake `<audio>` element reports, in seconds. */
  duration: 2_400,
}));

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    private files = new Map<string, Uint8Array>();
    async load() {}
    async writeFile(name: string, data: Uint8Array) {
      this.files.set(name, data);
    }
    async exec(args: string[]) {
      const output = args[args.length - 1]!;
      const index = Number(/chunk_(\d+)\.m4a$/.exec(output)![1]);
      this.files.set(output, new Uint8Array([index, this.files.get('input.m4a')![0]!]));
    }
    async readFile(name: string) {
      return this.files.get(name);
    }
    async deleteFile(name: string) {
      this.files.delete(name);
    }
  },
}));
vi.mock('@/lib/transcription/groq-client', () => ({
  requestGroqTranscription: h.requestGroqTranscription,
}));
vi.mock('./client', () => ({ sendOffscreenProgress: h.sendOffscreenProgress }));

const AUDIO_A = 'https://cdn.test/audio-a.m4a';
const AUDIO_B = 'https://cdn.test/audio-b.m4a';
/** Another host serving AUDIO_A's exact bytes (Douyin's backup / fallback URL of one track). */
const AUDIO_A_MIRROR = 'https://cdn-backup.test/audio-a.m4a';
const MAX_BYTES = 24 * 1024 * 1024;

/** 1000 bytes per track; the first byte tells the tracks apart. */
function audioBytes(url: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(1_000).fill(7);
  bytes[0] = url === AUDIO_B ? 0xb : 0xa;
  return bytes;
}

class FakeAudio {
  preload = '';
  duration = h.duration;
  private onMetadata: (() => void) | null = null;
  addEventListener(type: string, listener: () => void) {
    if (type === 'loadedmetadata') this.onMetadata = listener;
  }
  set src(_url: string) {
    queueMicrotask(() => this.onMetadata?.());
  }
}

function prepare(sessionId: string, audioUrl = AUDIO_A): OffscreenPrepareRequest {
  return { type: 'OFFSCREEN_CHUNK_PREPARE', sessionId, audioUrl, maxBytes: MAX_BYTES };
}

function transcribe(sessionId: string, extra: Partial<OffscreenTranscribeRequest> = {}): OffscreenTranscribeRequest {
  return {
    type: 'OFFSCREEN_CHUNK_TRANSCRIBE',
    sessionId,
    apiKey: 'key',
    model: 'whisper-large-v3-turbo',
    title: 'a long video',
    baseUrl: 'https://api.groq.com/openai/v1',
    ...extra,
  };
}

/** Chunk indices the ASR was asked for, in order. */
let asked: number[] = [];
/** Chunk indices that answer 429 once. */
let failOnce: Set<number> = new Set();

beforeEach(() => {
  vi.resetModules();
  asked = [];
  failOnce = new Set();
  h.duration = 2_400;
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => path } });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(audioBytes(url))));
  h.sendOffscreenProgress.mockReset();
  h.requestGroqTranscription.mockReset().mockImplementation(async (blob: Blob) => {
    const index = new Uint8Array(await blob.arrayBuffer())[0]!;
    asked.push(index);
    if (failOnce.delete(index)) {
      throw { code: 'ASR_RATE_LIMIT', message: 'HTTP 429 audio seconds per hour', retryAfter: 21 };
    }
    return {
      rows: [
        { start: 10, end: 14, text: `chunk ${index} opening` },
        { start: 300, end: 305, text: `chunk ${index} middle` },
      ],
      quota: {},
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function subsystem() {
  return import('./ffmpeg-subsystem');
}

/** One SW attempt: prepare, transcribe, and the SW's unconditional release. */
async function attempt(
  sub: Awaited<ReturnType<typeof subsystem>>,
  sessionId: string,
  audioUrl = AUDIO_A,
  extra: Partial<OffscreenTranscribeRequest> = {},
) {
  await sub.prepare(prepare(sessionId, audioUrl));
  try {
    return await sub.transcribe(transcribe(sessionId, extra));
  } finally {
    sub.release(sessionId);
  }
}

describe('ffmpeg-subsystem — chunked transcription resumes after a failed chunk (docs/38)', () => {
  it('a new chunk session for the same audio resumes at the failed chunk, and the rows equal one uninterrupted run', async () => {
    const sub = await subsystem();

    const baseline = await attempt(sub, 's0');
    expect(asked).toEqual([0, 1, 2, 3]);

    // Success forgot the progress: this attempt starts over, then fails at chunk 2.
    asked = [];
    failOnce = new Set([2]);
    await expect(attempt(sub, 's1')).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });
    expect(asked).toEqual([0, 1, 2]);

    asked = [];
    const resumed = await attempt(sub, 's2');
    expect(asked).toEqual([2, 3]);
    expect(JSON.stringify(resumed)).toBe(JSON.stringify(baseline));
    expect(h.sendOffscreenProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: 's2', chunkIndex: 3, totalChunks: 4 }),
    );
  });

  it('keys the track by its bytes, not its URL: the same bytes from a mirror resume too', async () => {
    const sub = await subsystem();
    failOnce = new Set([2]);
    await expect(attempt(sub, 's1')).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });

    asked = [];
    await attempt(sub, 's2', AUDIO_A_MIRROR);
    expect(asked).toEqual([2, 3]);
  });

  it.each([
    ['other audio bytes', AUDIO_B, {}],
    ['another model', AUDIO_A, { model: 'whisper-large-v3' }],
    ['another base URL', AUDIO_A, { baseUrl: 'https://api.siliconflow.cn/v1' }],
  ] as const)('does not resume across %s', async (_label, audioUrl, extra) => {
    const sub = await subsystem();
    failOnce = new Set([2]);
    await expect(attempt(sub, 's1')).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });

    asked = [];
    await attempt(sub, 's2', audioUrl, extra);
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('does not resume when the same audio is planned differently', async () => {
    const sub = await subsystem();
    failOnce = new Set([2]);
    await expect(attempt(sub, 's1')).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });

    h.duration = 2_000; // the last chunk ends earlier
    asked = [];
    await attempt(sub, 's2');
    expect(asked).toEqual([0, 1, 2, 3]);
  });
});
