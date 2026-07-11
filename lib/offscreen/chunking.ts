import type { SubtitleRow } from '@/lib/subtitle/types';
import type { ChunkPlan } from './types';
import {
  CHUNK_SECONDS,
  MIN_CHUNK_SECONDS,
  CHUNK_SIZE_SAFETY_RATIO,
} from '@/lib/transcription/constants';

export function estimateSafeChunkSeconds(
  totalBytes: number,
  durationSec: number,
  maxBytes: number,
): number {
  const bytesPerSecond = totalBytes / durationSec;
  const raw = Math.floor((maxBytes * CHUNK_SIZE_SAFETY_RATIO) / bytesPerSecond);
  return Math.max(MIN_CHUNK_SECONDS, Math.min(CHUNK_SECONDS, raw));
}

export function buildOverlappedChunkPlan(
  totalDuration: number,
  chunkDuration: number,
  overlap: number,
): ChunkPlan[] {
  const step = chunkDuration - overlap;
  const plans: ChunkPlan[] = [];
  let start = 0;
  let index = 0;

  while (start < totalDuration) {
    const remaining = totalDuration - start;

    // If the remaining duration is too short to be a standalone chunk,
    // extend the previous chunk to cover it instead of dropping audio.
    if (remaining < MIN_CHUNK_SECONDS && plans.length > 0) {
      const last = plans[plans.length - 1];
      last.durationSec = totalDuration - last.startSec;
      last.endSec = totalDuration;
      break;
    }

    const dur = Math.min(chunkDuration, remaining);
    plans.push({
      index,
      startSec: start,
      durationSec: dur,
      endSec: start + dur,
    });
    index++;
    start += step;
  }

  return plans;
}

export function mergeTimestampedChunkRows(
  accumulated: SubtitleRow[],
  newRows: SubtitleRow[],
  chunkStart: number,
  overlapSec: number,
): SubtitleRow[] {
  const trimThreshold = overlapSec;

  const offsetRows = newRows
    .filter((r) => r.end > trimThreshold || accumulated.length === 0)
    .map((r) => ({
      start: r.start + chunkStart,
      end: r.end + chunkStart,
      text: r.text,
    }));

  if (accumulated.length > 0 && offsetRows.length > 0) {
    const last = accumulated[accumulated.length - 1];
    const first = offsetRows[0];
    if (
      last.text === first.text &&
      Math.abs(last.end - first.start) < 1.5
    ) {
      accumulated[accumulated.length - 1] = {
        ...last,
        end: first.end,
      };
      offsetRows.shift();
    }
  }

  return [...accumulated, ...offsetRows];
}
