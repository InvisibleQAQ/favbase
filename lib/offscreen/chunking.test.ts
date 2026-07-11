import { describe, it, expect } from 'vitest';
import {
  estimateSafeChunkSeconds,
  buildOverlappedChunkPlan,
  mergeTimestampedChunkRows,
} from './chunking';
import {
  CHUNK_SECONDS,
  MIN_CHUNK_SECONDS,
  CHUNK_SIZE_SAFETY_RATIO,
} from '@/lib/transcription/constants';

describe('estimateSafeChunkSeconds', () => {
  it('caps at CHUNK_SECONDS for low-bitrate audio', () => {
    const result = estimateSafeChunkSeconds(1_000_000, 10_000, 24 * 1024 * 1024);
    expect(result).toBe(CHUNK_SECONDS);
  });

  it('floors at MIN_CHUNK_SECONDS for high-bitrate audio', () => {
    const result = estimateSafeChunkSeconds(100_000_000, 100, 1_000_000);
    expect(result).toBe(MIN_CHUNK_SECONDS);
  });

  it('returns floor(maxBytes * safety / bytesPerSecond) in the middle range', () => {
    const totalBytes = 100_000_000;
    const durationSec = 1_000;
    const maxBytes = 24 * 1024 * 1024;
    const bytesPerSecond = totalBytes / durationSec;
    const expected = Math.floor((maxBytes * CHUNK_SIZE_SAFETY_RATIO) / bytesPerSecond);

    expect(expected).toBeGreaterThan(MIN_CHUNK_SECONDS);
    expect(expected).toBeLessThan(CHUNK_SECONDS);
    expect(estimateSafeChunkSeconds(totalBytes, durationSec, maxBytes)).toBe(expected);
  });
});

describe('buildOverlappedChunkPlan', () => {
  it('produces a single chunk when total fits in one chunk', () => {
    expect(buildOverlappedChunkPlan(500, 600, 4)).toEqual([
      { index: 0, startSec: 0, durationSec: 500, endSec: 500 },
    ]);
  });

  it('overlaps consecutive chunks and covers the full duration', () => {
    const plans = buildOverlappedChunkPlan(1500, 600, 4);

    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(plans[0]).toEqual({ index: 0, startSec: 0, durationSec: 600, endSec: 600 });
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].startSec).toBe(plans[i - 1].endSec - 4);
    }
    expect(plans[plans.length - 1].endSec).toBe(1500);
  });

  it('extends the previous chunk when the tail is shorter than MIN_CHUNK_SECONDS', () => {
    const tail = MIN_CHUNK_SECONDS - 21; // 620 total → remaining 24 after first step
    const plans = buildOverlappedChunkPlan(596 + tail, 600, 4);

    expect(plans).toEqual([
      { index: 0, startSec: 0, durationSec: 596 + tail, endSec: 596 + tail },
    ]);
  });

  it('keeps the tail standalone when it is at least MIN_CHUNK_SECONDS', () => {
    const plans = buildOverlappedChunkPlan(650, 600, 4);

    expect(plans).toHaveLength(2);
    expect(plans[1]).toEqual({ index: 1, startSec: 596, durationSec: 54, endSec: 650 });
  });
});

describe('mergeTimestampedChunkRows', () => {
  it('keeps all rows and offsets them when accumulated is empty', () => {
    const result = mergeTimestampedChunkRows(
      [],
      [{ start: 0, end: 2, text: 'a' }],
      10,
      4,
    );
    expect(result).toEqual([{ start: 10, end: 12, text: 'a' }]);
  });

  it('drops rows that end inside the overlap window', () => {
    const accumulated = [{ start: 0, end: 596, text: 'x' }];
    const result = mergeTimestampedChunkRows(
      accumulated,
      [
        { start: 1, end: 3, text: 'y' },
        { start: 3, end: 8, text: 'z' },
      ],
      596,
      4,
    );
    expect(result).toEqual([
      { start: 0, end: 596, text: 'x' },
      { start: 599, end: 604, text: 'z' },
    ]);
  });

  it('merges a near-duplicate boundary row into the previous row', () => {
    const result = mergeTimestampedChunkRows(
      [{ start: 590, end: 596, text: 'hello' }],
      [{ start: 3.5, end: 6, text: 'hello' }],
      592,
      4,
    );
    expect(result).toEqual([{ start: 590, end: 598, text: 'hello' }]);
  });

  it('does not merge boundary rows with different text', () => {
    const result = mergeTimestampedChunkRows(
      [{ start: 590, end: 596, text: 'hello' }],
      [{ start: 3.5, end: 6, text: 'world' }],
      592,
      4,
    );
    expect(result).toEqual([
      { start: 590, end: 596, text: 'hello' },
      { start: 595.5, end: 598, text: 'world' },
    ]);
  });
});
