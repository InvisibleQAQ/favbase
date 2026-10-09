/**
 * The ASR half of a transcription prerequisite (docs/37 Step 3 ruling 10):
 * the storage reads every platform's auto-transcribe adapter needs — is the
 * active provider configured, wait until it is, and the durable quota pause.
 * Hoisted out of `lib/bilibili/auto-transcribe-adapter.ts` when Douyin became
 * the second caller; `lib/auto-transcribe` itself still reads no storage and
 * only ever sees these through an adapter.
 */

import { asrQuotaPauseStorage } from './ui-state';
import { getAsrSettings, resolveAsrConfig, settingsStorage, type UserSettings } from './settings';
import type { AutoTranscribeQuotaPause } from '@/lib/auto-transcribe/types';

/** True when the active ASR provider has a key right now. */
export async function hasAsrApiKey(): Promise<boolean> {
  const config = await getAsrSettings();
  return Boolean(config.apiKey);
}

/**
 * Resolves once the active ASR provider has a key. Watch first, then read:
 * reading first would lose an update that lands between the read and the
 * watch registration (lib/bilibili/CLAUDE.md pitfall).
 */
export function waitForAsrApiKey(): Promise<void> {
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
      console.error('[asr-prerequisite] Failed to read ASR settings:', error);
    });
  });
}

/** The persisted quota pause, only if it belongs to the active provider (lib/storage/CLAUDE.md). */
export async function getActiveAsrQuotaPause(): Promise<AutoTranscribeQuotaPause | null> {
  const [pause, settings] = await Promise.all([
    asrQuotaPauseStorage.getValue(),
    settingsStorage.getValue(),
  ]);
  return pause?.providerId === settings.asrProvider ? pause : null;
}

export async function setAsrQuotaPause(pause: AutoTranscribeQuotaPause | null): Promise<void> {
  await asrQuotaPauseStorage.setValue(pause);
}
