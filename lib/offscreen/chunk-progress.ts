/**
 * Resume table for chunked transcription (docs/38). A 429 on chunk k used to
 * throw the whole item away, so every retry re-sent chunks 0..k-1 and a track
 * whose audio exceeds the provider's hourly allowance could never finish. The
 * Offscreen Document lives as long as the extension, so it keeps, per track,
 * the rows merged so far and the next chunk to send; a later chunk session
 * for the same bytes picks up there.
 *
 * Zero I/O: the ASR call is injected, the clock is injectable. Only rows are
 * kept, never chunk bytes — a resumed session re-splits the audio it
 * downloaded itself, which is why an entry may live a day and the table
 * stays small.
 */

import type { SubtitleRow } from '@/lib/subtitle/types';
import { CHUNK_OVERLAP_SECONDS } from '@/lib/transcription/constants';
import { mergeTimestampedChunkRows } from './chunking';
import type { ChunkPlan } from './types';

/** An entry is forgotten a day after its last saved chunk. */
const PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;
/** Tracks remembered at once; the least recently used one goes first. */
const PROGRESS_CAPACITY = 8;

export interface ChunkProgress {
  /** The plan the rows were produced under; a resume needs an equal one. */
  plans: readonly ChunkPlan[];
  /** Rows merged from chunks `0 .. nextIndex - 1`, absolute timestamps. */
  rows: readonly SubtitleRow[];
  nextIndex: number;
}

export interface ChunkProgressStore {
  /**
   * The saved rows and next chunk for `key`, if still fresh and saved under a
   * plan equal to `plans` element by element; a mismatching entry is
   * discarded. A hit counts as a use for the LRU order.
   */
  resume(key: string, plans: readonly ChunkPlan[]): { rows: SubtitleRow[]; nextIndex: number } | null;
  save(key: string, progress: ChunkProgress): void;
  delete(key: string): void;
}

/**
 * Same audio bytes, same model, same endpoint — the three things the rows
 * depend on. The API key is deliberately not part of it: a key changed
 * between attempts still produces the same rows.
 */
export function chunkProgressKey(audioHash: string, model: string, baseUrl: string): string {
  return JSON.stringify([audioHash, model, baseUrl]);
}

function samePlans(a: readonly ChunkPlan[], b: readonly ChunkPlan[]): boolean {
  return a.length === b.length && a.every((plan, i) => {
    const other = b[i]!;
    return plan.index === other.index
      && plan.startSec === other.startSec
      && plan.durationSec === other.durationSec
      && plan.endSec === other.endSec;
  });
}

export function createChunkProgressStore(
  opts: { now?: () => number; ttlMs?: number; capacity?: number } = {},
): ChunkProgressStore {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? PROGRESS_TTL_MS;
  const capacity = opts.capacity ?? PROGRESS_CAPACITY;
  // Insertion order = use order: the first key is the least recently used.
  const entries = new Map<string, ChunkProgress & { savedAt: number }>();

  return {
    resume(key, plans) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (now() - entry.savedAt >= ttlMs || !samePlans(entry.plans, plans)) return null;
      entries.set(key, entry);
      return { rows: [...entry.rows], nextIndex: entry.nextIndex };
    },
    save(key, progress) {
      entries.delete(key);
      entries.set(key, {
        plans: progress.plans.map((plan) => ({ ...plan })),
        rows: [...progress.rows],
        nextIndex: progress.nextIndex,
        savedAt: now(),
      });
      while (entries.size > capacity) {
        entries.delete(entries.keys().next().value as string);
      }
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

/**
 * Send the chunks to the ASR in order, starting where `store` says a previous
 * attempt for `key` stopped, saving after every chunk and forgetting the
 * entry once the last one is merged. A failing chunk rejects with its own
 * error and leaves the progress up to the chunk before it. Chunk 0 goes
 * through the same merge as the rest: with nothing accumulated yet the merge
 * neither trims nor dedupes, it only offsets.
 */
export async function transcribeChunksResumable(params: {
  chunks: readonly { bytes: Uint8Array; plan: ChunkPlan }[];
  key: string;
  store: ChunkProgressStore;
  transcribeChunk: (bytes: Uint8Array) => Promise<SubtitleRow[]>;
  onChunkStart: (index: number, total: number) => void;
}): Promise<SubtitleRow[]> {
  const { chunks, key, store, transcribeChunk, onChunkStart } = params;
  const plans = chunks.map((chunk) => chunk.plan);
  const resumed = store.resume(key, plans);
  let rows = resumed?.rows ?? [];

  for (let i = resumed?.nextIndex ?? 0; i < chunks.length; i += 1) {
    const { bytes, plan } = chunks[i]!;
    onChunkStart(i, chunks.length);
    const chunkRows = await transcribeChunk(bytes);
    rows = mergeTimestampedChunkRows(rows, chunkRows, plan.startSec, CHUNK_OVERLAP_SECONDS);
    store.save(key, { plans, rows, nextIndex: i + 1 });
  }

  store.delete(key);
  return rows;
}
