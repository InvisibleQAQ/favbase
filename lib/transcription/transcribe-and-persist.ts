/**
 * The app-side persistence seam of a transcription, platform-agnostic
 * (docs/37 D-c): ask the Background pipeline for the transcript, refuse one
 * that answers for a different video, persist it through the platform's
 * injected writer, announce the durable content, hand the item to the
 * injected Embed / Tag lanes — and return without waiting for either lane.
 *
 * Not the Service Worker's per-platform transcription handler (those stay
 * independent, `lib/transcription/CLAUDE.md`): this is the OTHER end of the
 * `TRANSCRIBE_AUDIO` message, the one that writes the database. A platform
 * supplies `platform` + `persist` (its own `persistExistingItemContent`
 * wrapper) + the processing hooks; nothing platform-specific lives here, and
 * nothing here may import a `lib/<platform>/` module (the dependency runs
 * platform → shared, never back).
 *
 * The load graph stays storage-free (`tests/lib-import-smoke.test.ts`): the
 * background client, the domain-event bus and the transcription types only.
 */

import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import { onBackgroundPush, sendBackgroundMessage } from '@/lib/background/client';
import { emitDomainEvent } from '@/lib/events';
import { createErrorInfo, type TranscribeResponse, type TranscribeStatusPush } from './types';

/** The content state Embedding reached for an item; null = persistence failed. */
export type PersistContentResult = 'embedded' | 'chunked' | null;

export interface TranscribeProcessingTicket {
  embed: Promise<PersistContentResult>;
  tag: Promise<unknown>;
}

export type StartTranscribeProcessing = (videoId: string) => TranscribeProcessingTicket;

export interface TranscribePersistHooks {
  /** Fired after transcription succeeds, before local persistence and post-processing. */
  onIndexing?: () => void;
  /** Fired when Embedding settles with the reached content state (null = persist failed). */
  onIndexed?: (result: PersistContentResult) => void;
  /**
   * Starts independent post-processing lanes after content is durable. The
   * app runtime owns Embedding/Tagging (processing queue); this domain module
   * never calls a provider itself, so the seam is required, not defaulted.
   */
  startProcessing: StartTranscribeProcessing;
}

/**
 * The platform's writer: persist the transcript for its own item and report
 * `'chunked'`, or null when nothing was written (item missing, write failed).
 * `source` is how the transcript was obtained and must reach
 * `item_contents.subtitle_source` unchanged.
 */
export type PersistTranscript = (
  videoId: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
) => Promise<'chunked' | null>;

export interface TranscribeAndPersistInput {
  platform: string;
  videoId: string;
  title: string;
  persist: PersistTranscript;
  hooks: TranscribePersistHooks;
}

/**
 * Transcribe via the background pipeline, persist content + chunks locally,
 * then hand the durable item to the injected post-processing seam. Durable
 * content releases the producer immediately; post-processing never blocks the
 * next transcription.
 */
export async function transcribeAndPersist(
  input: TranscribeAndPersistInput,
): Promise<TranscribeResponse> {
  const { platform, videoId, title, persist, hooks } = input;
  const response: TranscribeResponse = await sendBackgroundMessage({
    type: 'TRANSCRIBE_AUDIO',
    platform,
    videoId,
    title,
  });

  if (response.success && response.data.videoId !== videoId) {
    // Byte-exact on purpose. BV ids are case-sensitive base58, so a case-only
    // difference is a different video, not the same one spelled differently —
    // and nothing between the request and here normalizes the echo. A lenient
    // compare here could only ever let a foreign transcript through, which is
    // the exact failure this gate exists to stop. The gate does not relax per
    // platform: a numeric aweme_id is compared the same way.
    console.error(
      `[transcribe] Refusing to persist: requested ${videoId}, transcript claims ${response.data.videoId}`,
      { rows: response.data.rows.length, source: response.data.source, cached: response.data.cached },
    );
    return {
      success: false,
      error: createErrorInfo(
        'TRANSCRIBE_VIDEO_ID_MISMATCH',
        `Transcript for ${response.data.videoId} was returned for ${videoId}; refusing to persist`,
        { requested: videoId, received: response.data.videoId },
      ),
    };
  }

  if (response.success) {
    hooks.onIndexing?.();
    const persisted = await persist(videoId, response.data.rows, response.data.source);
    if (!persisted) {
      hooks.onIndexed?.(null);
      return response;
    }

    emitDomainEvent('item-content-updated', { platform, platformItemId: videoId });

    const processing = hooks.startProcessing(videoId);
    void processing.tag;
    void processing.embed.then(
      (result) => hooks.onIndexed?.(result),
      () => hooks.onIndexed?.('chunked'),
    );
  }

  return response;
}

/** Subscribe to the pipeline's status pushes for the video `matchVideoId()` names right now. */
export function createStatusListener(
  matchVideoId: () => string,
  onStatus: (push: Pick<TranscribeStatusPush, 'progress' | 'stage' | 'stageParams' | 'error'>) => void,
): () => void {
  return onBackgroundPush('TRANSCRIBE_STATUS', (m) => {
    const target = matchVideoId();
    if (!target || m.videoId.toLowerCase() !== target.toLowerCase()) return;
    onStatus({ progress: m.progress, stage: m.stage, stageParams: m.stageParams, error: m.error });
  });
}
