import { BILIBILI_API } from '../bilibili/api';
import type { TranscribeErrorInfo } from './types';
import { PROGRESS } from './constants';

export class AudioExtractError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
    this.name = 'AudioExtractError';
  }
}

interface DashAudioStream {
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
  backupUrl?: string[];
  backup_url?: string[];
}

export async function extractAudioUrl(
  bvid: string,
  cid: number,
): Promise<string> {
  const url = BILIBILI_API.playUrl(bvid, cid);
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: `playurl API 失败: HTTP ${res.status}`,
    });
  }

  const json = await res.json();

  if (Number(json?.code ?? 0) !== 0) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: `playurl API 返回失败: ${String(json?.message || '未知错误')}`,
    });
  }

  const dash = json?.data?.dash;

  if (!dash?.audio?.length) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: '未提取到音轨地址',
    });
  }

  const streams: DashAudioStream[] = dash.audio;
  streams.sort(
    (a: DashAudioStream, b: DashAudioStream) =>
      (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );

  const first = streams[0];
  const audioUrl = first.baseUrl ?? first.base_url;

  if (!audioUrl) {
    throw new AudioExtractError({
      code: 'ASR_NO_AUDIO_SOURCE',
      message: '音轨 URL 为空',
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
      message:
        res.status === 403
          ? '音频下载失败: 付费或受限内容'
          : `音频下载失败: HTTP ${res.status}`,
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
