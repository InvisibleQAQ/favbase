import type { TranscribeResponse, TranscribeStatusPush } from '@/lib/transcription/types';
import { embedPlatformItem } from '@/lib/embedding';
import { emitDomainEvent } from '@/lib/events';
import { tagPlatformItem } from '@/lib/tagging';
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
  /** Starts independent post-processing lanes after content is durable. */
  startProcessing?: StartTranscribeProcessing;
}

const startProcessingDirectly: StartTranscribeProcessing = (bvid) => ({
  embed: embedPlatformItem(PLATFORM, bvid),
  tag: tagPlatformItem(PLATFORM, bvid),
});

/**
 * Transcribe via the background pipeline, persist content + chunks locally,
 * then start Embedding and Tagging independently. Durable content releases the
 * producer immediately; post-processing never blocks the next transcription.
 */
export async function transcribeAndPersist(
  bvid: string,
  title: string,
  hooks?: TranscribePersistHooks,
): Promise<TranscribeResponse> {
  const response = (await browser.runtime.sendMessage({
    type: 'TRANSCRIBE_AUDIO',
    platform: 'bilibili',
    videoId: bvid,
    title,
  })) as TranscribeResponse;

  if (response.success) {
    hooks?.onIndexing?.();
    const persisted = await persistContentChunks(bvid, response.data.rows, response.data.source);
    if (!persisted) {
      hooks?.onIndexed?.(null);
      return response;
    }

    emitDomainEvent('item-content-updated', { platform: PLATFORM, platformItemId: bvid });

    const processing = (hooks?.startProcessing ?? startProcessingDirectly)(bvid);
    void processing.tag;
    void processing.embed.then(
      (result) => hooks?.onIndexed?.(result),
      () => hooks?.onIndexed?.('chunked'),
    );
  }

  return response;
}

export function createStatusListener(
  matchBvid: () => string,
  onStatus: (push: Pick<TranscribeStatusPush, 'progress' | 'stage' | 'stageParams' | 'error'>) => void,
): () => void {
  const handler = (msg: unknown) => {
    const m = msg as TranscribeStatusPush;
    if (m?.type !== 'TRANSCRIBE_STATUS') return;
    const target = matchBvid();
    if (!target || m.videoId.toLowerCase() !== target.toLowerCase()) return;
    onStatus({ progress: m.progress, stage: m.stage, stageParams: m.stageParams, error: m.error });
  };
  browser.runtime.onMessage.addListener(handler);
  return () => browser.runtime.onMessage.removeListener(handler);
}
