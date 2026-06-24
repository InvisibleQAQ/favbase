import { fetchPlayUrl } from '../bilibili/bilibili-api';
import type { DashAudioStream } from '../bilibili/types';
import type { TranscribeErrorInfo } from './types';
import { PROGRESS } from './constants';

export class AudioExtractError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
    this.name = 'AudioExtractError';
  }
}

export async function extractAudioUrl(
  bvid: string,
  cid: number,
): Promise<string> {
  let dash;
  try {
    dash = await fetchPlayUrl(bvid, cid);
  } catch (err) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: err instanceof Error ? err.message : 'playurl API failed',
    });
  }

  const streams = [...dash.audio].sort(
    (a: DashAudioStream, b: DashAudioStream) =>
      (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );

  const first = streams[0];
  const audioUrl = first.baseUrl ?? first.base_url;

  if (!audioUrl) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: 'Audio track URL is empty',
    });
  }

  return audioUrl;
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
    headers: {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': navigator.userAgent,
    },
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
