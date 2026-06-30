import type { BackgroundContext } from '@/lib/background/types';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type {
  TranscribeRequest,
  TranscribeResponse,
} from '@/lib/transcription/types';
import { getAsrSettings } from '@/lib/storage';
import { getVideoCache, mergeVideoCache } from '@/lib/cache/video-cache';
import { runTranscriptionPipeline } from '@/lib/transcription/pipeline';
import { prepareBiliTranscription } from './bilibili-transcription-adapter';
import {
  notifyTab,
  createTranscribeAudio,
} from '@/lib/background/transcription-utils';

export async function handleBiliTranscribe(
  msg: TranscribeRequest,
  tabId: number,
  ctx: BackgroundContext,
  signal: AbortSignal,
): Promise<TranscribeResponse> {
  const { videoId, title } = msg;

  const biliCtx = await prepareBiliTranscription(videoId, msg.cid);

  const deps = {
    getAsrConfig: getAsrSettings,
    fetchOfficialSubtitle: biliCtx.fetchOfficialSubtitle,
    transcribeAudio: createTranscribeAudio(tabId, ctx, biliCtx.extractAudioUrl),
    cacheGet: async (id: string) => {
      const entry = await getVideoCache('bilibili', id);
      if (!entry) return null;
      return { rows: entry.rows, source: entry.source };
    },
    cacheSave: async (id: string, rows: SubtitleRow[], source: SubtitleSource) => {
      await mergeVideoCache('bilibili', id, rows, source);
    },
    postProcess: biliCtx.postProcess,
  };

  const result = await runTranscriptionPipeline(
    {
      videoId,
      cid: biliCtx.cid,
      title,
      signal,
      officialSourceLabel: 'official',
      asrSourceLabel: 'asr',
    },
    deps,
    (progress, stage, stageParams) => {
      notifyTab(ctx, tabId, videoId, progress, stage, undefined, stageParams);
    },
  );
  if (!result.success) {
    notifyTab(ctx, tabId, videoId, 0, 'failed', result.error);
  }
  return result;
}
