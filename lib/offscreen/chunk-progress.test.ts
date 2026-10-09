import { describe, expect, it, vi } from 'vitest';

import type { SubtitleRow } from '@/lib/subtitle/types';
import {
  chunkProgressKey,
  createChunkProgressStore,
  transcribeChunksResumable,
  type ChunkProgressStore,
} from './chunk-progress';
import type { ChunkPlan } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function plan(index: number, startSec: number, durationSec = 600): ChunkPlan {
  return { index, startSec, durationSec, endSec: startSec + durationSec };
}

/** Four overlapped 600 s chunks, the shape `buildOverlappedChunkPlan` gives a 40 min track. */
const PLANS: ChunkPlan[] = [plan(0, 0), plan(1, 596), plan(2, 1192), plan(3, 1788, 612)];

/** One fake chunk per plan; the bytes name the chunk so the fake ASR can answer per chunk. */
const CHUNKS = PLANS.map((p) => ({ bytes: new Uint8Array([p.index]), plan: p }));

/**
 * Rows relative to their chunk. Chunk 2 opens with chunk 1's closing line
 * inside the overlap, so the merge extends a row in place across that seam.
 */
function asrRows(index: number): SubtitleRow[] {
  const rows: SubtitleRow[] = [
    { start: 10, end: 14, text: `chunk ${index} opening` },
    { start: 300, end: 305, text: `chunk ${index} middle` },
  ];
  if (index === 1) rows.push({ start: 595, end: 599, text: 'a line across the seam' });
  if (index === 2) rows.unshift({ start: 3, end: 6, text: 'a line across the seam' });
  return rows;
}

function fakeAsr(failAt: Set<number> = new Set()) {
  const calls: number[] = [];
  const transcribeChunk = vi.fn(async (bytes: Uint8Array) => {
    const index = bytes[0]!;
    calls.push(index);
    if (failAt.delete(index)) {
      throw { code: 'ASR_RATE_LIMIT', message: 'HTTP 429', retryAfter: 21 };
    }
    return asrRows(index);
  });
  return { calls, transcribeChunk };
}

function runAll(store: ChunkProgressStore, transcribeChunk: (bytes: Uint8Array) => Promise<SubtitleRow[]>, key = 'k') {
  const starts: number[] = [];
  const result = transcribeChunksResumable({
    chunks: CHUNKS,
    key,
    store,
    transcribeChunk,
    onChunkStart: (index, total) => {
      expect(total).toBe(CHUNKS.length);
      starts.push(index);
    },
  });
  return { result, starts };
}

async function uninterrupted(): Promise<SubtitleRow[]> {
  const { transcribeChunk } = fakeAsr();
  return runAll(createChunkProgressStore(), transcribeChunk).result;
}

describe('chunkProgressKey', () => {
  it('differs when the audio hash, the model or the base URL differs', () => {
    const base = chunkProgressKey('hash', 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1');
    expect(chunkProgressKey('hash', 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1')).toBe(base);
    expect(chunkProgressKey('other', 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1')).not.toBe(base);
    expect(chunkProgressKey('hash', 'whisper-large-v3', 'https://api.groq.com/openai/v1')).not.toBe(base);
    expect(chunkProgressKey('hash', 'whisper-large-v3-turbo', 'https://api.siliconflow.cn/v1')).not.toBe(base);
  });

  it('cannot be forged by moving a separator between the parts', () => {
    expect(chunkProgressKey('a|b', 'c', 'd')).not.toBe(chunkProgressKey('a', 'b|c', 'd'));
  });
});

describe('createChunkProgressStore', () => {
  const ROWS: SubtitleRow[] = [{ start: 1, end: 2, text: 'one' }];

  it('resumes saved progress for the same key and an equal plan', () => {
    const store = createChunkProgressStore({ now: () => 0 });
    store.save('k', { plans: PLANS, rows: ROWS, nextIndex: 2 });
    expect(store.resume('k', PLANS.map((p) => ({ ...p })))).toEqual({ rows: ROWS, nextIndex: 2 });
    expect(store.resume('other', PLANS)).toBeNull();
  });

  it.each([
    ['one chunk fewer', PLANS.slice(0, 3)],
    ['a moved start', PLANS.map((p) => (p.index === 2 ? { ...p, startSec: 1193 } : p))],
    ['another duration', PLANS.map((p) => (p.index === 3 ? { ...p, durationSec: 611 } : p))],
    ['another end', PLANS.map((p) => (p.index === 1 ? { ...p, endSec: 1197 } : p))],
    ['another index', PLANS.map((p) => (p.index === 0 ? { ...p, index: 9 } : p))],
  ])('discards the progress when the plan differs (%s)', (_label, plans) => {
    const store = createChunkProgressStore({ now: () => 0 });
    store.save('k', { plans: PLANS, rows: ROWS, nextIndex: 2 });
    expect(store.resume('k', plans)).toBeNull();
    // Discarded, not merely skipped: the original plan finds nothing either.
    expect(store.resume('k', PLANS)).toBeNull();
  });

  it('forgets progress 24 h after it was last saved', () => {
    let clock = 1_000;
    const store = createChunkProgressStore({ now: () => clock });
    store.save('k', { plans: PLANS, rows: ROWS, nextIndex: 1 });
    clock = 1_000 + DAY_MS - 1;
    expect(store.resume('k', PLANS)).not.toBeNull();
    clock = 1_000 + DAY_MS;
    expect(store.resume('k', PLANS)).toBeNull();
  });

  it('holds 8 entries and drops the least recently used one', () => {
    const store = createChunkProgressStore({ now: () => 0 });
    for (let i = 0; i < 8; i += 1) store.save(`k${i}`, { plans: PLANS, rows: ROWS, nextIndex: 1 });
    // A resume is a use: k0 is now newer than k1.
    expect(store.resume('k0', PLANS)).not.toBeNull();
    store.save('k8', { plans: PLANS, rows: ROWS, nextIndex: 1 });
    expect(store.resume('k1', PLANS)).toBeNull();
    expect(store.resume('k0', PLANS)).not.toBeNull();
    expect(store.resume('k8', PLANS)).not.toBeNull();
  });

  it('keeps its own copies of rows and plans', () => {
    const store = createChunkProgressStore({ now: () => 0 });
    const rows = [...ROWS];
    const plans = PLANS.map((p) => ({ ...p }));
    store.save('k', { plans, rows, nextIndex: 1 });
    rows.push({ start: 9, end: 10, text: 'later' });
    plans[0]!.startSec = 42;
    const resumed = store.resume('k', PLANS)!;
    expect(resumed.rows).toEqual(ROWS);
    resumed.rows[0] = { start: 0, end: 0, text: 'changed' };
    expect(store.resume('k', PLANS)!.rows).toEqual(ROWS);
  });

  it('delete removes the entry', () => {
    const store = createChunkProgressStore({ now: () => 0 });
    store.save('k', { plans: PLANS, rows: ROWS, nextIndex: 1 });
    store.delete('k');
    expect(store.resume('k', PLANS)).toBeNull();
  });
});

describe('transcribeChunksResumable', () => {
  it('transcribes every chunk once in order, merges across the overlap and forgets the progress on success', async () => {
    const store = createChunkProgressStore();
    const { calls, transcribeChunk } = fakeAsr();
    const { result, starts } = runAll(store, transcribeChunk);
    const rows = await result;

    expect(calls).toEqual([0, 1, 2, 3]);
    expect(starts).toEqual([0, 1, 2, 3]);
    expect(rows[0]).toEqual({ start: 10, end: 14, text: 'chunk 0 opening' });
    // The seam row is one row, extended to chunk 2's end of it.
    expect(rows.filter((row) => row.text === 'a line across the seam')).toEqual([
      { start: 1191, end: 1198, text: 'a line across the seam' },
    ]);
    expect(store.resume('k', PLANS)).toBeNull();
  });

  it.each([1, 2, 3])('after chunk %i fails, the retry asks the ASR only from that chunk on and ends byte-identical', async (k) => {
    const baseline = await uninterrupted();
    const store = createChunkProgressStore();
    const { calls, transcribeChunk } = fakeAsr(new Set([k]));

    const first = runAll(store, transcribeChunk);
    await expect(first.result).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });
    expect(store.resume('k', PLANS)).toMatchObject({ nextIndex: k });

    const second = runAll(store, transcribeChunk);
    const rows = await second.result;

    const firstRun = Array.from({ length: k + 1 }, (_, i) => i);
    const secondRun = Array.from({ length: CHUNKS.length - k }, (_, i) => k + i);
    expect(calls).toEqual([...firstRun, ...secondRun]);
    expect(second.starts).toEqual(secondRun);
    expect(JSON.stringify(rows)).toBe(JSON.stringify(baseline));
    expect(store.resume('k', PLANS)).toBeNull();
  });

  it('a failure on the first chunk saves nothing to resume from', async () => {
    const store = createChunkProgressStore();
    const { transcribeChunk } = fakeAsr(new Set([0]));
    await expect(runAll(store, transcribeChunk).result).rejects.toMatchObject({ code: 'ASR_RATE_LIMIT' });
    expect(store.resume('k', PLANS)).toBeNull();
  });

  it('progress under another key is not used', async () => {
    const store = createChunkProgressStore();
    const failing = fakeAsr(new Set([2]));
    await expect(runAll(store, failing.transcribeChunk, 'audio-a').result).rejects.toBeDefined();

    const other = fakeAsr();
    await runAll(store, other.transcribeChunk, 'audio-b').result;
    expect(other.calls).toEqual([0, 1, 2, 3]);
    expect(store.resume('audio-a', PLANS)).toMatchObject({ nextIndex: 2 });
  });
});
