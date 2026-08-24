import { sql, eq, isNotNull } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import * as schema from '@/lib/database/schema';
import {
  EmbeddingDimensionError,
  EmbeddingDimensionLimitError,
  MAX_INDEXABLE_DIMENSIONS,
} from './errors';
import type { ChunkInput } from './types';

const { itemChunks, items } = schema;

// ---------------------------------------------------------------------------
// replaceItemChunks
// ---------------------------------------------------------------------------

export interface ReplacedChunk {
  id: string;
  chunkIndex: number;
  chunkText: string;
}

/**
 * Rebuild an item's chunks: transactional delete-by-item + batch insert with
 * `chunk_index` numbered from 0 (satisfies `uq(item_id, chunk_index)` on
 * repeat transcriptions). Time span goes into `start_sec`/`end_sec` (NULL for
 * non-timed content). Returns the inserted rows so the caller can attach
 * embeddings by id. Empty `chunks` just clears existing rows.
 */
export async function replaceItemChunks(
  db: FavbaseDb,
  itemId: string,
  chunks: ChunkInput[],
): Promise<ReplacedChunk[]> {
  return db.transaction(async (tx) => {
    await tx.delete(itemChunks).where(eq(itemChunks.itemId, itemId));
    if (chunks.length === 0) return [];

    const inserted = await tx
      .insert(itemChunks)
      .values(
        chunks.map((chunk, i) => ({
          itemId,
          chunkIndex: i,
          chunkText: chunk.text,
          startSec: chunk.startSec ?? null,
          endSec: chunk.endSec ?? null,
        })),
      )
      .returning({
        id: itemChunks.id,
        chunkIndex: itemChunks.chunkIndex,
        chunkText: itemChunks.chunkText,
      });
    if (inserted.length !== chunks.length) {
      throw new Error(
        `Chunk persistence invariant failed for item ${itemId}: ` +
          `expected ${chunks.length} rows, inserted ${inserted.length}.`,
      );
    }
    return inserted;
  });
}

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
// Column dimension (pg catalog is the single source of truth)
// ---------------------------------------------------------------------------

/** Minimal executor surface shared by `FavbaseDb` and its transaction client. */
type SqlExecutor = Pick<FavbaseDb, 'execute'>;

/**
 * Read the current `item_chunks.embedding` column dimension from the pg
 * catalog. pgvector encodes the declared dimension directly as `atttypmod`
 * (no VARHDRSZ offset), so the raw value IS the dimension. The column always
 * carries a typmod in this project (migration v001 creates vector(1536) and
 * `alterEmbeddingDimensions` only writes typmod'd types); `-1` would mean a
 * bare `vector` column and is treated as corruption.
 */
export async function getEmbeddingColumnDimensions(db: SqlExecutor): Promise<number> {
  const result = await db.execute<{ atttypmod: number }>(sql`
    SELECT atttypmod FROM pg_attribute
    WHERE attrelid = 'item_chunks'::regclass AND attname = 'embedding'
  `);
  const rows = (result.rows ?? []) as { atttypmod: number }[];
  const dimensions = Number(rows[0]?.atttypmod);
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error(
      `item_chunks.embedding has no fixed dimension (atttypmod=${rows[0]?.atttypmod ?? 'missing'})`,
    );
  }
  return dimensions;
}

/** Reject dimensions the HNSW index cannot hold (and non-integers / <1). */
function assertIndexableDimensions(dimensions: number): void {
  if (
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > MAX_INDEXABLE_DIMENSIONS
  ) {
    throw new EmbeddingDimensionLimitError(dimensions);
  }
}

/**
 * Re-dimension the embedding column to follow the active model. A single DDL
 * does all the work (empirically verified on PGlite 0.5 + pgvector 0.8.1, see
 * task research): `ALTER ... TYPE vector(N) USING NULL::vector(N)` empties
 * every old vector, changes the declared dimension, and PostgreSQL rebuilds
 * the dependent HNSW index automatically with the same opclass. Old vectors
 * are meaningless for a different model anyway, so 'embedded' items revert to
 * 'chunked' for re-embedding.
 *
 * Concurrency: PGlite is single-connection and the RPC proxy serializes
 * transactions, so re-reading the column dimension inside the transaction
 * (double-check) makes concurrent switches converge — the loser sees the
 * winner's dimension and no-ops instead of re-clearing.
 */
export async function alterEmbeddingDimensions(
  db: FavbaseDb,
  dimensions: number,
): Promise<void> {
  assertIndexableDimensions(dimensions);

  await db.transaction(async (tx) => {
    const current = await getEmbeddingColumnDimensions(tx);
    if (current === dimensions) return;

    // `dimensions` is validated as a positive integer above — safe to inline
    // (DDL cannot take bind params).
    await tx.execute(
      sql.raw(
        `ALTER TABLE item_chunks ALTER COLUMN embedding TYPE vector(${dimensions}) ` +
          `USING NULL::vector(${dimensions})`,
      ),
    );
    // All old vectors are gone — items that were 'embedded' no longer are.
    await tx
      .update(items)
      .set({ contentState: 'chunked' })
      .where(eq(items.contentState, 'embedded'));
  });
}

// ---------------------------------------------------------------------------
// upsertChunkEmbeddings
// ---------------------------------------------------------------------------

export interface ChunkEmbeddingEntry {
  chunkId: string;
  vector: number[];
}

/**
 * Write vectors onto existing `item_chunks` rows (UPDATE by id). This is the
 * lazy dimension-adaptation convergence point: when the batch's dimension
 * differs from the current column width, the column is re-dimensioned first
 * (old vectors cleared, 'embedded' items reverted to 'chunked'), then the new
 * batch is written. Mixed-dimension batches and dimensions beyond the HNSW
 * cap are rejected before touching the DB. Chunks are expected to already
 * exist (created by the chunker); this only fills the `embedding` column.
 */
export async function upsertChunkEmbeddings(
  db: FavbaseDb,
  entries: ChunkEmbeddingEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // A batch comes from one model — mixed dimensions are a caller bug.
  const dimensions = entries[0].vector.length;
  for (const { vector } of entries) {
    if (vector.length !== dimensions) {
      throw new EmbeddingDimensionError(vector.length, dimensions);
    }
  }
  assertIndexableDimensions(dimensions);

  if ((await getEmbeddingColumnDimensions(db)) !== dimensions) {
    await alterEmbeddingDimensions(db, dimensions);
  }

  // If another context re-dimensions the column between the check above and
  // these UPDATEs, pgvector's column type rejects the writes ("expected N
  // dimensions, not M") — the column itself is the final guard.
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
 *
 * The query vector is validated against the CURRENT column dimension (read
 * from the pg catalog). It comes from the active model, so it naturally
 * matches; a mismatch means config drift and an explicit error beats silently
 * empty results.
 */
export async function semanticSearchChunks(
  db: FavbaseDb,
  queryVector: number[],
  options: SemanticSearchOptions,
): Promise<SemanticSearchHit[]> {
  const columnDimensions = await getEmbeddingColumnDimensions(db);
  if (queryVector.length !== columnDimensions) {
    throw new EmbeddingDimensionError(queryVector.length, columnDimensions);
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
