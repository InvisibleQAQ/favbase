import type { SubtitleRow, SubtitleSource } from '@/lib/transcription/types';

export interface VideoCacheEntry {
  bvid: string;
  rows: SubtitleRow[];
  source: SubtitleSource;
  rawHash: string;
  updatedAt: number;
}

export interface GetVideoCacheRequest {
  type: 'GET_VIDEO_CACHE';
  bvid: string;
}

export interface CacheSubtitleRequest {
  type: 'CACHE_SUBTITLE';
  bvid: string;
  rows: SubtitleRow[];
  source: SubtitleSource;
}
