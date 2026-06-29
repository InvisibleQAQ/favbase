import type { TranscribeResponse, TranscribeStatusPush } from '@/lib/transcription/types';
import { persistContent } from './bili-sync-service';

export async function transcribeAndPersist(
  bvid: string,
  title: string,
): Promise<TranscribeResponse> {
  const response = (await browser.runtime.sendMessage({
    type: 'TRANSCRIBE_AUDIO',
    platform: 'bilibili',
    videoId: bvid,
    title,
  })) as TranscribeResponse;

  if (response.success) {
    persistContent(bvid, response.data.rows, response.data.source);
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
