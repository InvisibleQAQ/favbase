import type { TranscribeResponse, TranscribeStatusPush } from '@/lib/transcription/types';
import { persistContent, type PersistContentResult } from './bili-sync-service';

export interface TranscribePersistHooks {
  /** Fired after transcription succeeds, right before local chunk+embed indexing. */
  onIndexing?: () => void;
  /** Fired when indexing settles with the reached content state (null = persist failed). */
  onIndexed?: (result: PersistContentResult) => void;
}

/**
 * Transcribe via background pipeline, then persist + index locally (awaited so
 * the UI can show an "indexing" stage until chunk+embed completes). Indexing
 * failures never affect the transcription result.
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
    const result = await persistContent(bvid, response.data.rows, response.data.source);
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
