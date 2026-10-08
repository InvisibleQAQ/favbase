import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundContext } from './types';
import { GROQ_MAX_AUDIO_BYTES } from '@/lib/transcription/constants';
import { createErrorInfo } from '@/lib/transcription/types';

// Boundary of `createTranscribeAudio`: the ASR client, the shared downloader,
// the fingerprint guard and the Offscreen Document. The platform's URL
// extractor is the thing under test — what it returns and what it throws.
const boundary = vi.hoisted(() => ({
  ensureGroqConnectivity: vi.fn(async () => {}),
  requestGroqTranscription: vi.fn(),
  fetchFirstAudioBlob: vi.fn(),
  assertAudioNotReused: vi.fn(async () => {}),
  sendOffscreenMessage: vi.fn(),
}));

vi.mock('@/lib/transcription/groq-client', () => ({
  ensureGroqConnectivity: boundary.ensureGroqConnectivity,
  requestGroqTranscription: boundary.requestGroqTranscription,
}));
vi.mock('@/lib/transcription/audio-extractor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/transcription/audio-extractor')>()),
  fetchFirstAudioBlob: boundary.fetchFirstAudioBlob,
}));
vi.mock('@/lib/transcription/audio-fingerprint', () => ({
  assertAudioNotReused: boundary.assertAudioNotReused,
}));
vi.mock('@/lib/offscreen/client', () => ({
  sendOffscreenMessage: boundary.sendOffscreenMessage,
}));

import { createTranscribeAudio } from './transcription-utils';

const ROWS = [{ start: 0, end: 1, text: 'line' }];
const CANDIDATES = ['https://cdn-a/audio', 'https://cdn-b/audio', 'https://www.douyin.com/aweme/v1/play/?x'];
const TAB_ID = 7;

function context(): BackgroundContext {
  return {
    sendToTab: vi.fn(),
    ensureOffscreen: vi.fn(async () => {}),
    registerChunkSession: vi.fn(),
    unregisterChunkSession: vi.fn(),
  } as unknown as BackgroundContext;
}

function params(signal: AbortSignal = new AbortController().signal) {
  return {
    videoId: '7300000000000000123',
    cid: 0,
    config: { apiKey: 'key', model: 'model', baseUrl: 'https://asr.test' },
    signal,
    title: 'a video',
    onProgress: vi.fn(),
  };
}

beforeEach(() => {
  boundary.ensureGroqConnectivity.mockReset().mockResolvedValue(undefined);
  boundary.requestGroqTranscription.mockReset().mockResolvedValue({ rows: ROWS, quota: {} });
  boundary.fetchFirstAudioBlob.mockReset();
  boundary.assertAudioNotReused.mockReset().mockResolvedValue(undefined);
  boundary.sendOffscreenMessage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTranscribeAudio — the extractor returns candidates and its errors pass through', () => {
  it('passes a TranscribeErrorInfo thrown by the extractor through unchanged (docs/37 ruling 3)', async () => {
    const ctx = context();
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => {
      throw createErrorInfo('DOUYIN_TAB_MISSING', 'no usable www.douyin.com tab', { reason: 'closed' });
    });

    await expect(transcribe(params())).rejects.toMatchObject({
      code: 'DOUYIN_TAB_MISSING',
      params: { reason: 'closed' },
    });
    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('passes an abort thrown by the extractor through unchanged', async () => {
    const ctx = context();
    const aborted = new DOMException('Aborted', 'AbortError');
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => {
      throw aborted;
    });

    await expect(transcribe(params())).rejects.toBe(aborted);
    expect(boundary.fetchFirstAudioBlob).not.toHaveBeenCalled();
  });

  it('folds any other extractor failure into ASR_NO_AUDIO_SOURCE', async () => {
    const ctx = context();
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => {
      throw new Error('Audio track URL is empty in DASH manifest');
    });

    await expect(transcribe(params())).rejects.toMatchObject({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: 'Audio track URL is empty in DASH manifest',
    });
  });

  it('hands the whole candidate list to the shared downloader and uploads the blob it picked', async () => {
    const ctx = context();
    const blob = { size: 1024 } as Blob;
    boundary.fetchFirstAudioBlob.mockResolvedValue({ url: CANDIDATES[1], blob });
    const p = params();
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => CANDIDATES);

    await expect(transcribe(p)).resolves.toEqual(ROWS);

    expect(boundary.fetchFirstAudioBlob).toHaveBeenCalledTimes(1);
    expect(boundary.fetchFirstAudioBlob.mock.calls[0]![0]).toEqual(CANDIDATES);
    expect(boundary.fetchFirstAudioBlob.mock.calls[0]![1]).toBe(p.signal);
    expect(boundary.assertAudioNotReused).toHaveBeenCalledWith(blob, p.videoId);
    expect(boundary.requestGroqTranscription).toHaveBeenCalledWith(blob, 'key', 'model', p.signal, 'https://asr.test');
    expect(boundary.sendOffscreenMessage).not.toHaveBeenCalled();
  });

  it('sends the Offscreen chunker the candidate that actually downloaded, not the first one listed', async () => {
    const ctx = context();
    boundary.fetchFirstAudioBlob.mockResolvedValue({
      url: CANDIDATES[1],
      blob: { size: GROQ_MAX_AUDIO_BYTES + 1 } as Blob,
    });
    boundary.sendOffscreenMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'OFFSCREEN_CHUNK_PREPARE') return { success: true };
      if (msg.type === 'OFFSCREEN_CHUNK_TRANSCRIBE') return { success: true, rows: ROWS };
      return { success: true };
    });
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => CANDIDATES);

    await expect(transcribe(params())).resolves.toEqual(ROWS);

    const types = boundary.sendOffscreenMessage.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types).toEqual(['OFFSCREEN_CHUNK_PREPARE', 'OFFSCREEN_CHUNK_TRANSCRIBE', 'OFFSCREEN_CHUNK_RELEASE']);
    const prepare = boundary.sendOffscreenMessage.mock.calls[0]![0] as { audioUrl: string; maxBytes: number };
    expect(prepare.audioUrl).toBe(CANDIDATES[1]);
    expect(prepare.maxBytes).toBe(GROQ_MAX_AUDIO_BYTES);
    expect(ctx.registerChunkSession).toHaveBeenCalledTimes(1);
    expect(ctx.unregisterChunkSession).toHaveBeenCalledTimes(1);
    expect(boundary.requestGroqTranscription).not.toHaveBeenCalled();
  });

  it('releases the Offscreen session even when chunk transcription fails', async () => {
    const ctx = context();
    boundary.fetchFirstAudioBlob.mockResolvedValue({
      url: CANDIDATES[0],
      blob: { size: GROQ_MAX_AUDIO_BYTES + 1 } as Blob,
    });
    boundary.sendOffscreenMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'OFFSCREEN_CHUNK_PREPARE') return { success: true };
      if (msg.type === 'OFFSCREEN_CHUNK_TRANSCRIBE') {
        return { success: false, error: createErrorInfo('ASR_CHUNKING_FAILED', 'ffmpeg died') };
      }
      return { success: true };
    });
    const transcribe = createTranscribeAudio(TAB_ID, ctx, async () => CANDIDATES);

    await expect(transcribe(params())).rejects.toMatchObject({ code: 'ASR_CHUNKING_FAILED' });

    const types = boundary.sendOffscreenMessage.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types.at(-1)).toBe('OFFSCREEN_CHUNK_RELEASE');
    expect(ctx.unregisterChunkSession).toHaveBeenCalledTimes(1);
  });
});
