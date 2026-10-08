/**
 * Bilibili's transcription persistence seam: the platform-agnostic core in
 * `lib/transcription/transcribe-and-persist.ts` (docs/37 D-c) bound to this
 * platform's id and writer. The public signature is unchanged from when the
 * core lived here; the byte-exact video-id gate, the `item-content-updated`
 * event and the `startProcessing` hand-off are the core's and are proven
 * against a real persist by `transcribe-utils.test.ts`.
 */
import type { TranscribeResponse } from '@/lib/transcription/types';
import {
  transcribeAndPersist as transcribeAndPersistCore,
  type TranscribePersistHooks,
} from '@/lib/transcription/transcribe-and-persist';
import { persistContentChunks } from './bili-sync-service';

export type { PersistContentResult } from './bili-sync-service';
export type {
  StartTranscribeProcessing,
  TranscribePersistHooks,
  TranscribeProcessingTicket,
} from '@/lib/transcription/transcribe-and-persist';
export { createStatusListener } from '@/lib/transcription/transcribe-and-persist';

const PLATFORM = 'bilibili';

/**
 * Transcribe via the background pipeline, persist content + chunks locally,
 * then hand the durable item to the injected post-processing seam.
 */
export function transcribeAndPersist(
  bvid: string,
  title: string,
  hooks: TranscribePersistHooks,
): Promise<TranscribeResponse> {
  return transcribeAndPersistCore({
    platform: PLATFORM,
    videoId: bvid,
    title,
    persist: persistContentChunks,
    hooks,
  });
}
