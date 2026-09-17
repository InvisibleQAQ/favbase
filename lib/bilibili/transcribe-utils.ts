import {
  createErrorInfo,
  type TranscribeResponse,
  type TranscribeStatusPush,
} from '@/lib/transcription/types';
import { onBackgroundPush, sendBackgroundMessage } from '@/lib/background/client';
import { emitDomainEvent } from '@/lib/events';
import { persistContentChunks, type PersistContentResult } from './bili-sync-service';

const PLATFORM = 'bilibili';

export interface TranscribeProcessingTicket {
  embed: Promise<PersistContentResult>;
  tag: Promise<unknown>;
}

export type StartTranscribeProcessing = (bvid: string) => TranscribeProcessingTicket;

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
 * Transcribe via the background pipeline, persist content + chunks locally,
 * then hand the durable item to the injected post-processing seam. Durable
 * content releases the producer immediately; post-processing never blocks the
 * next transcription.
 */
export async function transcribeAndPersist(
  bvid: string,
  title: string,
  hooks: TranscribePersistHooks,
): Promise<TranscribeResponse> {
  const response: TranscribeResponse = await sendBackgroundMessage({
    type: 'TRANSCRIBE_AUDIO',
    platform: 'bilibili',
    videoId: bvid,
    title,
  });

  if (response.success && response.data.videoId !== bvid) {
    // Byte-exact on purpose. BV ids are case-sensitive base58, so a case-only
    // difference is a different video, not the same one spelled differently —
    // and nothing between the request and here normalizes the echo. A lenient
    // compare here could only ever let a foreign transcript through, which is
    // the exact failure this gate exists to stop.
    console.error(
      `[transcribe] Refusing to persist: requested ${bvid}, transcript claims ${response.data.videoId}`,
      { rows: response.data.rows.length, source: response.data.source, cached: response.data.cached },
    );
    return {
      success: false,
      error: createErrorInfo(
        'TRANSCRIBE_VIDEO_ID_MISMATCH',
        `Transcript for ${response.data.videoId} was returned for ${bvid}; refusing to persist`,
        { requested: bvid, received: response.data.videoId },
      ),
    };
  }

  if (response.success) {
    hooks.onIndexing?.();
    const persisted = await persistContentChunks(bvid, response.data.rows, response.data.source);
    if (!persisted) {
      hooks.onIndexed?.(null);
      return response;
    }

    emitDomainEvent('item-content-updated', { platform: PLATFORM, platformItemId: bvid });

    const processing = hooks.startProcessing(bvid);
    void processing.tag;
    void processing.embed.then(
      (result) => hooks.onIndexed?.(result),
      () => hooks.onIndexed?.('chunked'),
    );
  }

  return response;
}

export function createStatusListener(
  matchBvid: () => string,
  onStatus: (push: Pick<TranscribeStatusPush, 'progress' | 'stage' | 'stageParams' | 'error'>) => void,
): () => void {
  return onBackgroundPush('TRANSCRIBE_STATUS', (m) => {
    const target = matchBvid();
    if (!target || m.videoId.toLowerCase() !== target.toLowerCase()) return;
    onStatus({ progress: m.progress, stage: m.stage, stageParams: m.stageParams, error: m.error });
  });
}
