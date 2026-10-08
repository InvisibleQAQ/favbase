import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { onDomainEvent } from '@/lib/events';
import type { SubtitleRow } from '@/lib/subtitle/types';
import type { TranscribeResponse } from './types';
import {
  transcribeAndPersist,
  type PersistContentResult,
  type PersistTranscript,
  type TranscribeProcessingTicket,
} from './transcribe-and-persist';

// Boundary: the background bridge (browser.runtime) only. The persist seam is
// a fake — this is the platform-agnostic core, and what it proves (the id
// gate, the event, the processing hand-off) must hold for ANY platform
// string. The Bilibili wrapper's own suite (`lib/bilibili/transcribe-utils.test.ts`)
// exercises the same core against a real PGlite persist.
const sendMessage = vi.fn();

const PLATFORM = 'douyin';
const VIDEO_ID = '7300000000000000123';
const ROWS: SubtitleRow[] = [{ start: 0, end: 3, text: '第一句' }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const NEVER = new Promise<never>(() => undefined);

function settledTicket(embed: PersistContentResult = 'embedded'): TranscribeProcessingTicket {
  return { embed: Promise.resolve(embed), tag: Promise.resolve() };
}

function successResponse(videoId: string): TranscribeResponse {
  return { success: true, data: { videoId, rows: ROWS, source: 'asr', cached: false } };
}

function persistOk(): PersistTranscript {
  return vi.fn(async () => 'chunked' as const);
}

async function captureEvents(run: () => Promise<unknown>): Promise<Array<{ platform: string; platformItemId: string }>> {
  const seen: Array<{ platform: string; platformItemId: string }> = [];
  const off = onDomainEvent('item-content-updated', (event) => seen.push(event));
  try {
    await run();
  } finally {
    off();
  }
  return seen;
}

describe('transcribeAndPersist (platform-agnostic core)', () => {
  beforeAll(() => {
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('asks the background for the given platform and video id, verbatim', async () => {
    sendMessage.mockResolvedValueOnce(successResponse(VIDEO_ID));
    await transcribeAndPersist({
      platform: PLATFORM,
      videoId: VIDEO_ID,
      title: 'A Douyin video',
      persist: persistOk(),
      hooks: { startProcessing: () => settledTicket() },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'TRANSCRIBE_AUDIO',
      platform: PLATFORM,
      videoId: VIDEO_ID,
      title: 'A Douyin video',
    });
  });

  it('persists, emits item-content-updated for that platform, hands off processing and returns before Embedding settles', async () => {
    const response = successResponse(VIDEO_ID);
    sendMessage.mockResolvedValueOnce(response);
    const persist = persistOk();
    const embedding = deferred<PersistContentResult>();
    const order: string[] = [];
    const onIndexing = vi.fn(() => order.push('indexing'));
    const onIndexed = vi.fn();
    const startProcessing = vi.fn((id: string) => {
      order.push(`processing:${id}`);
      return { embed: embedding.promise, tag: NEVER };
    });
    (persist as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('persist');
      return 'chunked';
    });

    let result: TranscribeResponse | undefined;
    const seen = await captureEvents(async () => {
      result = await transcribeAndPersist({
        platform: PLATFORM,
        videoId: VIDEO_ID,
        title: 't',
        persist,
        hooks: { onIndexing, onIndexed, startProcessing },
      });
    });

    expect(result).toEqual(response);
    expect(persist).toHaveBeenCalledWith(VIDEO_ID, ROWS, 'asr');
    expect(order).toEqual(['indexing', 'persist', `processing:${VIDEO_ID}`]);
    expect(seen).toEqual([{ platform: PLATFORM, platformItemId: VIDEO_ID }]);
    // Durable content releases the caller; the Embedding ticket is a late notice.
    expect(onIndexed).not.toHaveBeenCalled();
    embedding.resolve('embedded');
    await vi.waitFor(() => expect(onIndexed).toHaveBeenCalledWith('embedded'));
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  it('reports chunked when the Embedding ticket rejects', async () => {
    sendMessage.mockResolvedValueOnce(successResponse(VIDEO_ID));
    const embedding = deferred<PersistContentResult>();
    const onIndexed = vi.fn();
    await transcribeAndPersist({
      platform: PLATFORM,
      videoId: VIDEO_ID,
      title: 't',
      persist: persistOk(),
      hooks: { onIndexed, startProcessing: () => ({ embed: embedding.promise, tag: NEVER }) },
    });
    expect(onIndexed).not.toHaveBeenCalled();
    embedding.reject(new Error('embedding unavailable'));
    await vi.waitFor(() => expect(onIndexed).toHaveBeenCalledWith('chunked'));
    expect(onIndexed).toHaveBeenCalledTimes(1);
  });

  it('refuses a transcript whose video id differs from the request, byte for byte', async () => {
    sendMessage.mockResolvedValueOnce(successResponse('7300000000000000124'));
    const persist = persistOk();
    const startProcessing = vi.fn(() => settledTicket());
    const onIndexing = vi.fn();
    const onIndexed = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    let result: TranscribeResponse | undefined;
    const seen = await captureEvents(async () => {
      result = await transcribeAndPersist({
        platform: PLATFORM,
        videoId: VIDEO_ID,
        title: 't',
        persist,
        hooks: { onIndexing, onIndexed, startProcessing },
      });
    });
    const errorArgs = logged.mock.calls;
    logged.mockRestore();

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'TRANSCRIBE_VIDEO_ID_MISMATCH',
        params: { requested: VIDEO_ID, received: '7300000000000000124' },
      }),
    });
    expect(persist).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
    expect(onIndexing).not.toHaveBeenCalled();
    expect(onIndexed).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    // The gate is a locating tool first: exactly one line, both ids on it.
    expect(errorArgs).toHaveLength(1);
    expect(String(errorArgs[0][0])).toContain(VIDEO_ID);
    expect(String(errorArgs[0][0])).toContain('7300000000000000124');
  });

  it('reports null and starts nothing when the persist seam returns null', async () => {
    sendMessage.mockResolvedValueOnce(successResponse(VIDEO_ID));
    const persist: PersistTranscript = vi.fn(async () => null);
    const startProcessing = vi.fn(() => settledTicket());
    const onIndexed = vi.fn();

    const seen = await captureEvents(() =>
      transcribeAndPersist({
        platform: PLATFORM,
        videoId: VIDEO_ID,
        title: 't',
        persist,
        hooks: { onIndexed, startProcessing },
      }),
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(onIndexed).toHaveBeenCalledWith(null);
    expect(startProcessing).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('does nothing but return the failure when transcription fails', async () => {
    const response: TranscribeResponse = { success: false, error: { code: 'ASR_UNKNOWN', message: 'boom' } };
    sendMessage.mockResolvedValueOnce(response);
    const persist = persistOk();
    const startProcessing = vi.fn(() => settledTicket());
    const onIndexing = vi.fn();
    const onIndexed = vi.fn();

    let result: TranscribeResponse | undefined;
    const seen = await captureEvents(async () => {
      result = await transcribeAndPersist({
        platform: PLATFORM,
        videoId: VIDEO_ID,
        title: 't',
        persist,
        hooks: { onIndexing, onIndexed, startProcessing },
      });
    });

    expect(result).toEqual(response);
    expect(persist).not.toHaveBeenCalled();
    expect(onIndexing).not.toHaveBeenCalled();
    expect(onIndexed).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
