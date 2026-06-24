import type { TranscribeErrorInfo } from './types';
import { PROGRESS } from './constants';

export class AudioExtractError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
    this.name = 'AudioExtractError';
  }
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
    throw new AudioExtractError({
      code: 'DOWNLOAD_FAILED',
      message: `Audio download failed: HTTP ${res.status}`,
      params: { status: res.status },
    });
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
