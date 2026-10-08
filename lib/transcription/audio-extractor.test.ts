import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchFirstAudioBlob, isAbortError } from './audio-extractor';

// The candidate walk (docs/37 Step 2 ruling 2): a platform hands over every
// URL its media may be downloaded from, in order, and the first that answers
// wins. The probe behind it: Douyin's audio-only `main_url` host refuses a
// Referer-less Service Worker request with 403 while `backup_url` answers 200.
// Platform-agnostic — a single URL is a list of one.

const URLS = [
  'https://v26-web.douyinvod.com/sig/exp/video/tos/cn/audio-a/',
  'https://v11-weba.douyinvod.com/sig/exp/video/tos/cn/audio-a/',
  'https://www.douyin.com/aweme/v1/play/?file_id=audio-a&sign=s',
];

function answer(status: number, body = 'audio-bytes'): Response {
  return new Response(body, { status, headers: { 'content-length': String(body.length) } });
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchFirstAudioBlob', () => {
  it('moves past a non-2xx candidate and returns the first that downloads, with its URL', async () => {
    fetchMock.mockResolvedValueOnce(answer(403, 'Forbid_code: 020200')).mockResolvedValueOnce(answer(200, 'fMP4'));
    const signal = new AbortController().signal;

    const got = await fetchFirstAudioBlob(URLS, signal);

    expect(got.url).toBe(URLS[1]);
    expect(got.blob.size).toBe('fMP4'.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([URLS[0], URLS[1]]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', mode: 'cors', signal });
  });

  it('moves past a network error (the fetch rejected) as well', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(answer(200));

    const got = await fetchFirstAudioBlob(URLS, new AbortController().signal);

    expect(got.url).toBe(URLS[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets an abort through at once instead of trying the next candidate', async () => {
    const aborted = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(aborted);

    await expect(fetchFirstAudioBlob(URLS, new AbortController().signal)).rejects.toBe(aborted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after a candidate fails when the signal is already aborted, whatever the failure was', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return answer(503);
    });

    await expect(fetchFirstAudioBlob(URLS, controller.signal)).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the LAST failure when every candidate fails', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(403))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(404));

    await expect(fetchFirstAudioBlob(URLS, new AbortController().signal)).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
      params: { status: 404 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('an empty candidate list is ASR_NO_AUDIO_SOURCE without a single request', async () => {
    await expect(fetchFirstAudioBlob([], new AbortController().signal)).rejects.toMatchObject({
      code: 'ASR_NO_AUDIO_SOURCE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards download progress of the winning candidate', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, 'x'.repeat(1000)));
    const onProgress = vi.fn();

    await fetchFirstAudioBlob([URLS[0]!], new AbortController().signal, onProgress);

    expect(onProgress).toHaveBeenCalled();
  });
});

describe('isAbortError', () => {
  it('is true only for a DOMException named AbortError', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('nope', 'NotFoundError'))).toBe(false);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
