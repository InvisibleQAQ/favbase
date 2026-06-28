import type { PipelineDeps } from '@/lib/transcription/pipeline';
import type { SubtitleRow } from '@/lib/transcription/types';
import type { BiliAuthInfo } from './types';
import {
  getBiliAuth,
  fetchCidByPageList,
  fetchSubtitle,
  extractBiliAudioUrl,
} from './bilibili-api';
import { processSubtitles } from './subtitle-processor';

export interface BiliTranscriptionContext {
  cid: number;
  fetchOfficialSubtitle: PipelineDeps['fetchOfficialSubtitle'];
  extractAudioUrl: (bvid: string, cid: number) => Promise<string>;
  postProcess: PipelineDeps['postProcess'];
}

const SUBTITLE_RETRY_DELAYS = [1000, 2000];

function createFetchOfficialSubtitle(auth: BiliAuthInfo | null) {
  return async (bvid: string, cid: number): Promise<SubtitleRow[] | null> => {
    for (let attempt = 0; attempt <= SUBTITLE_RETRY_DELAYS.length; attempt++) {
      try {
        const result = await fetchSubtitle(bvid, cid, auth ?? undefined);
        if (result.status === 'ok' && result.rows.length > 0) return result.rows;
        if (result.status === 'no_subtitle') return null;
        if (attempt < SUBTITLE_RETRY_DELAYS.length) {
          console.warn(
            `[biliAdapter] Official subtitle error for ${bvid} (attempt ${attempt + 1}): ${result.error ?? 'unknown'} — retrying`,
          );
          await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_DELAYS[attempt]));
        }
      } catch (err) {
        if (attempt < SUBTITLE_RETRY_DELAYS.length) {
          console.warn(
            `[biliAdapter] Official subtitle threw for ${bvid} (attempt ${attempt + 1}): ${err instanceof Error ? err.message : err} — retrying`,
          );
          await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_DELAYS[attempt]));
        }
      }
    }
    return null;
  };
}

export async function prepareBiliTranscription(
  bvid: string,
  requestCid?: number,
): Promise<BiliTranscriptionContext> {
  const auth = await getBiliAuth();
  const cid = requestCid || (await fetchCidByPageList(bvid, 1, auth ?? undefined));

  return {
    cid,
    fetchOfficialSubtitle: createFetchOfficialSubtitle(auth),
    extractAudioUrl: extractBiliAudioUrl,
    postProcess: processSubtitles,
  };
}
