import type { TranscribeResponse, TranscribeStatusPush } from '@/lib/transcription/types';
import { embedPlatformItem } from '@/lib/embedding';
import { tagPlatformItem } from '@/lib/tagging';
import { persistContentChunks, type PersistContentResult } from './bili-sync-service';

const PLATFORM = 'bilibili';

export interface TranscribePersistHooks {
  /** Fired after transcription succeeds, before local persistence and post-processing. */
  onIndexing?: () => void;
  /** Fired when Embedding settles with the reached content state (null = persist failed). */
  onIndexed?: (result: PersistContentResult) => void;
}

/**
 * Transcribe via the background pipeline, persist content + chunks locally,
 * then start Embedding and Tagging independently. Only Embedding is awaited
 * for the UI indexing state; post-processing never changes transcription.
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

    const embedding = embedPlatformItem(PLATFORM, bvid);
    void tagPlatformItem(PLATFORM, bvid);
    const result = await embedding;
    hooks?.onIndexed?.(result);
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
