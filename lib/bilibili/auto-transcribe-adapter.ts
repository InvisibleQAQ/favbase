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
  asrQuotaPauseStorage,
  getAsrSettings,
  resolveAsrConfig,
  settingsStorage,
  type UserSettings,
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

    async hasAsrKey(): Promise<boolean> {
      const config = await getAsrSettings();
      return Boolean(config.apiKey);
    },

    waitForAsrKey(): Promise<void> {
      return new Promise((resolve) => {
        let unwatch: (() => void) | null = null;
        let resolved = false;
        const accept = (settings: UserSettings): void => {
          if (resolved || !resolveAsrConfig(settings).apiKey) return;
          resolved = true;
          unwatch?.();
          resolve();
        };

        unwatch = settingsStorage.watch(accept);
        if (resolved) unwatch();
        void settingsStorage.getValue().then(accept).catch((error) => {
          console.error('[auto-transcribe] Failed to read ASR settings:', error);
        });
      });
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
