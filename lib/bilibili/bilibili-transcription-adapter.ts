import type { PipelineDeps } from '@/lib/transcription/pipeline';
import type { SubtitleRow } from '@/lib/subtitle/types';
import {
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

async function fetchOfficialSubtitle(bvid: string, cid: number): Promise<SubtitleRow[] | null> {
  for (let attempt = 0; attempt <= SUBTITLE_RETRY_DELAYS.length; attempt++) {
    try {
      const result = await fetchSubtitle(bvid, cid);
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
}

/**
 * Bilibili's pieces of the transcription pipeline. No auth is read here: the
 * Background SW's fetch already carries the bilibili cookie jar (docs/29 E2),
 * and `bilibili-api.ts` asks for it with `credentials: 'include'`.
 */
export async function prepareBiliTranscription(
  bvid: string,
  requestCid?: number,
): Promise<BiliTranscriptionContext> {
  const cid = requestCid || (await fetchCidByPageList(bvid));

  return {
    cid,
    fetchOfficialSubtitle,
    extractAudioUrl: extractBiliAudioUrl,
    postProcess: processSubtitles,
  };
}
