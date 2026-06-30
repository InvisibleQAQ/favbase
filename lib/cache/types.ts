import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';

export interface VideoCacheEntry {
  platform: string;
  videoId: string;
  rows: SubtitleRow[];
  source: SubtitleSource;
  rawHash: string;
  updatedAt: number;
}

export interface GetVideoCacheRequest {
  type: 'GET_VIDEO_CACHE';
  platform: string;
  videoId: string;
}

export interface CacheSubtitleRequest {
  type: 'CACHE_SUBTITLE';
  platform: string;
  videoId: string;
  rows: SubtitleRow[];
  source: SubtitleSource;
}
