import { AUDIO_FINGERPRINT_LRU_SIZE } from './constants';
import type { TranscribeErrorInfo } from './types';

interface FingerprintEntry {
  hash: string;
  bvid: string;
  usedAt: number;
}

const lru: FingerprintEntry[] = [];

async function sha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class AudioReuseError extends Error {
  constructor(public info: TranscribeErrorInfo) {
    super(info.message);
    this.name = 'AudioReuseError';
  }
}

export async function assertAudioNotReused(
  blob: Blob,
  bvid: string,
): Promise<void> {
  const hash = await sha256(blob);

  const existing = lru.find((e) => e.hash === hash);
  if (existing && existing.bvid !== bvid) {
    throw new AudioReuseError({
      code: 'ASR_AUDIO_REUSED',
      message: `音频指纹重复 (原 ${existing.bvid}，当前 ${bvid})，可能是 SPA 导航残留数据`,
    });
  }

  if (existing) {
    existing.usedAt = Date.now();
  } else {
    lru.push({ hash, bvid, usedAt: Date.now() });
    if (lru.length > AUDIO_FINGERPRINT_LRU_SIZE) {
      lru.sort((a, b) => a.usedAt - b.usedAt);
      lru.shift();
    }
  }
}
