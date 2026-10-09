import { AUDIO_FINGERPRINT_LRU_SIZE } from './constants';
import { createErrorInfo } from './types';

interface FingerprintEntry {
  hash: string;
  videoId: string;
  usedAt: number;
}

const lru: FingerprintEntry[] = [];

/** Lower-case hex SHA-256 of raw bytes; the Offscreen chunk-resume table keys tracks by it too. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}

export async function assertAudioNotReused(
  blob: Blob,
  videoId: string,
): Promise<void> {
  const hash = await sha256(blob);

  const existing = lru.find((e) => e.hash === hash);
  if (existing && existing.videoId !== videoId) {
    throw createErrorInfo('ASR_AUDIO_REUSED', `Audio fingerprint collision (existing ${existing.videoId}, current ${videoId}), likely stale SPA navigation data`);
  }

  if (existing) {
    existing.usedAt = Date.now();
  } else {
    lru.push({ hash, videoId, usedAt: Date.now() });
    if (lru.length > AUDIO_FINGERPRINT_LRU_SIZE) {
      lru.sort((a, b) => a.usedAt - b.usedAt);
      lru.shift();
    }
  }
}
