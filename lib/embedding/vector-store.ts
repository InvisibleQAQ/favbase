import { sql, eq, isNotNull } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { schema } from '@/lib/database';
import { EMBEDDING_DIMENSIONS } from '@/lib/ai';
import { EmbeddingDimensionError } from './errors';

const { itemChunks } = schema;

// ---------------------------------------------------------------------------
// toSqlVector
// ---------------------------------------------------------------------------

/**
 * Serialize a number[] into pgvector's text literal form `'[a,b,c]'`. Pure +
 * unit-testable. Bound into SQL as `$vec::vector` (string param, RPC-safe).
 */
export function toSqlVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

// ---------------------------------------------------------------------------
// upsertChunkEmbeddings
// ---------------------------------------------------------------------------

export interface ChunkEmbeddingEntry {
  chunkId: string;
  vector: number[];
}

/**
 * Write vectors onto existing `item_chunks` rows (UPDATE by id). Rejects any
 * off-dimension vector up front — pgvector's fixed VECTOR(1536) column + ANN
 * index cannot store them. Chunks are expected to already exist (created by the
 * chunker in the consumer phase); this only fills the `embedding` column.
 */
export async function upsertChunkEmbeddings(
  db: FavbaseDb,
  entries: ChunkEmbeddingEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  for (const { vector } of entries) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingDimensionError(vector.length);
    }
  }

  for (const { chunkId, vector } of entries) {
    await db
      .update(itemChunks)
      .set({ embedding: vector, updatedAt: new Date() })
      .where(eq(itemChunks.id, chunkId));
  }
}

// ---------------------------------------------------------------------------
// semanticSearchChunks
// ---------------------------------------------------------------------------

export interface SemanticSearchOptions {
  topK: number;
  /** Drop results with cosine score below this (score = 1 - distance). */
  minScore?: number;
}

export interface SemanticSearchHit {
  chunkId: string;
  itemId: string;
  chunkText: string;
  score: number;
}

interface SearchRow extends Record<string, unknown> {
  chunk_id: string;
  item_id: string;
  chunk_text: string;
  score: number;
}

/**
 * Cosine ANN search over `item_chunks.embedding`. Orders by pgvector `<=>`
 * (cosine distance) and returns the top-K nearest chunks. `score = 1 - distance`
 * (higher = closer). The query vector is bound as a `'[...]'::vector` string
 * param, which survives the RPC/PortBridge boundary as plain text.
 */
export async function semanticSearchChunks(
  db: FavbaseDb,
  queryVector: number[],
  options: SemanticSearchOptions,
): Promise<SemanticSearchHit[]> {
  if (queryVector.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingDimensionError(queryVector.length);
  }

  const { topK, minScore } = options;
  const vec = toSqlVector(queryVector);

  const result = await db.execute<SearchRow>(sql`
    SELECT
      id AS chunk_id,
      item_id,
      chunk_text,
      1 - (embedding <=> ${vec}::vector) AS score
    FROM item_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${topK}
  `);

  const rows = (result.rows ?? []) as SearchRow[];
  const hits = rows.map((r) => ({
    chunkId: r.chunk_id,
    itemId: r.item_id,
    chunkText: r.chunk_text,
    score: Number(r.score),
  }));

  return minScore === undefined ? hits : hits.filter((h) => h.score >= minScore);
}

// ---------------------------------------------------------------------------
// deleteItemEmbeddings / clearAllEmbeddings
// ---------------------------------------------------------------------------

/** Null out embeddings for a single item's chunks (rebuild / re-index). */
export async function deleteItemEmbeddings(
  db: FavbaseDb,
  itemId: string,
): Promise<void> {
  await db
    .update(itemChunks)
    .set({ embedding: null, updatedAt: new Date() })
    .where(eq(itemChunks.itemId, itemId));
}

/** Null out every chunk embedding (full vector-index clear). */
export async function clearAllEmbeddings(db: FavbaseDb): Promise<void> {
  await db
    .update(itemChunks)
    .set({ embedding: null, updatedAt: new Date() })
    .where(isNotNull(itemChunks.embedding));
}

// ---------------------------------------------------------------------------
// getEmbeddingStats
// ---------------------------------------------------------------------------

export interface EmbeddingStats {
  embeddedChunks: number;
  totalChunks: number;
}

/** Coverage counters for the settings vector-index panel. */
export async function getEmbeddingStats(db: FavbaseDb): Promise<EmbeddingStats> {
  const rows = await db
    .select({
      total: sql<number>`count(*)`,
      embedded: sql<number>`count(${itemChunks.embedding})`,
    })
    .from(itemChunks);

  const row = rows[0];
  return {
    embeddedChunks: Number(row?.embedded ?? 0),
    totalChunks: Number(row?.total ?? 0),
  };
}
