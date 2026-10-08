import { createErrorInfo } from './types';
import { PROGRESS } from './constants';

/** The cancellation the pipeline folds into `ASR_REQUEST_TIMEOUT`; never swallowed on the way there. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export interface FetchedAudio {
  /** The candidate that actually downloaded — the one to hand the Offscreen chunker. */
  url: string;
  blob: Blob;
}

/**
 * Walk the candidates in order and return the first that downloads. A
 * non-2xx (`DOWNLOAD_FAILED`) or a network error moves on to the next; an
 * abort propagates at once; when every candidate failed, the LAST failure is
 * thrown, and an empty list is `ASR_NO_AUDIO_SOURCE`. Platform-agnostic: a
 * single URL is a list of one. (Douyin lists three hosts per track because
 * the first refuses a Referer-less Service Worker — docs/37 D-g.)
 */
export async function fetchFirstAudioBlob(
  urls: readonly string[],
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<FetchedAudio> {
  let last: unknown = null;
  for (const url of urls) {
    try {
      return { url, blob: await fetchAudioBlob(url, signal, onProgress) };
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw err;
      console.warn(`[audio-extractor] ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
      last = err;
    }
  }
  throw last ?? createErrorInfo('ASR_NO_AUDIO_SOURCE', 'No audio URL to download');
}

export async function fetchAudioBlob(
  audioUrl: string,
  signal: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const res = await fetch(audioUrl, {
    method: 'GET',
    credentials: 'omit',
    mode: 'cors',
    signal,
  });

  if (!res.ok) {
    throw createErrorInfo('DOWNLOAD_FAILED', `Audio download failed: HTTP ${res.status}`, { status: res.status });
  }

  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (!res.body) {
    return res.blob();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReportedPercent = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.byteLength;

    if (contentLength > 0 && onProgress) {
      const percent = Math.floor((received / contentLength) * 100);
      if (percent >= lastReportedPercent + 10) {
        lastReportedPercent = percent;
        const mapped =
          PROGRESS.DOWNLOAD_BEGIN +
          ((PROGRESS.DOWNLOAD_END - PROGRESS.DOWNLOAD_BEGIN) * percent) / 100;
        onProgress(Math.round(mapped));
      }
    }
  }

  return new Blob(
    chunks.map((c) => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer),
    { type: 'audio/mp4' },
  );
}
