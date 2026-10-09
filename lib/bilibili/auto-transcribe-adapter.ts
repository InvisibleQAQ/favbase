import type {
  AutoTranscribeAdapter,
} from '@/lib/auto-transcribe/types';
import type { TranscribeResponse } from '@/lib/transcription/types';
import { markVideoError } from './bili-sync-service';
import {
  transcribeAndPersist,
  createStatusListener,
  type StartTranscribeProcessing,
} from './transcribe-utils';
import {
  getActiveAsrQuotaPause,
  hasAsrApiKey,
  setAsrQuotaPause,
  waitForAsrApiKey,
} from '@/lib/storage';

export interface BiliAutoTranscribeAdapterOptions {
  /** App-owned Embed/Tag lanes; the adapter never calls a provider itself. */
  startProcessing: StartTranscribeProcessing;
}

export function createBiliAutoTranscribeAdapter(
  options: BiliAutoTranscribeAdapterOptions,
): AutoTranscribeAdapter {
  return {
    async transcribe(videoId: string, title: string, onIndexing?: () => void): Promise<TranscribeResponse> {
      return transcribeAndPersist(videoId, title, {
        onIndexing,
        startProcessing: options.startProcessing,
      });
    },

    markError: markVideoError,

    // Bilibili's only prerequisite is the ASR key, judged NOW: an invalid-key
    // answer with a key already saved is an ordinary per-item failure.
    missingPrerequisite: async (error) =>
      error.code === 'ASR_INVALID_KEY' && !(await hasAsrApiKey()) ? 'asr' : null,

    waitForPrerequisite: () => waitForAsrApiKey(),

    getQuotaPause: getActiveAsrQuotaPause,

    setQuotaPause: setAsrQuotaPause,

    createStatusListener,
  };
}
