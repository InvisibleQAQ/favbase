import type {
  AutoTranscribeAdapter,
  AutoTranscribePageResult,
  AutoTranscribePreview,
} from '@/lib/auto-transcribe/types';
import type { TranscribeResponse } from '@/lib/transcription/types';
import {
  checkAuth,
  fetchAndSyncVideos,
  getPendingBvids,
  getPendingPreview,
  markVideoError,
} from './bili-sync-service';
import {
  transcribeAndPersist,
  createStatusListener,
  type StartTranscribeProcessing,
} from './transcribe-utils';
import { normalizeCover } from './url-utils';
import {
  asrQuotaPauseStorage,
  getAsrSettings,
  settingsStorage,
} from '@/lib/storage';

export interface BiliAutoTranscribeAdapterOptions {
  startProcessing?: StartTranscribeProcessing;
}

export function createBiliAutoTranscribeAdapter(
  options: BiliAutoTranscribeAdapterOptions = {},
): AutoTranscribeAdapter {
  return {
    async checkAuth() { await checkAuth(); },

    async fetchPage(collectionId: string, page: number): Promise<AutoTranscribePageResult> {
      const mediaId = Number(collectionId);
      const result = await fetchAndSyncVideos(mediaId, page);
      return {
        videos: result.videos.map((v) => ({
          videoId: v.bvid,
          title: v.title,
          cover: normalizeCover(v.cover),
          author: v.upper.name,
          duration: v.duration,
          isInvalid: v.attr === 9 || !v.bvid,
        })),
        totalPages: result.totalPages,
        totalCount: result.mediaCount,
      };
    },

    getPendingIds: getPendingBvids,

    async getPreview(collectionId: string): Promise<AutoTranscribePreview> {
      const mediaId = Number(collectionId);
      const preview = await getPendingPreview(mediaId);
      return {
        video: preview.video
          ? {
              cover: preview.video.cover,
              title: preview.video.title,
              author: preview.video.upper,
              duration: preview.video.duration,
            }
          : null,
        pendingCount: preview.pendingCount,
      };
    },

    async transcribe(videoId: string, title: string, onIndexing?: () => void): Promise<TranscribeResponse> {
      return transcribeAndPersist(videoId, title, {
        onIndexing,
        startProcessing: options.startProcessing,
      });
    },

    markError: markVideoError,

    async hasAsrKey(): Promise<boolean> {
      const config = await getAsrSettings();
      return Boolean(config.apiKey);
    },

    async getQuotaPause() {
      const [pause, settings] = await Promise.all([
        asrQuotaPauseStorage.getValue(),
        settingsStorage.getValue(),
      ]);
      return pause?.providerId === settings.asrProvider ? pause : null;
    },

    async setQuotaPause(pause) {
      await asrQuotaPauseStorage.setValue(pause);
    },

    createStatusListener,
  };
}
