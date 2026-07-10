import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import {
  EmbeddingDimensionError,
  EmbeddingDimensionLimitError,
  MAX_INDEXABLE_DIMENSIONS,
} from './errors';
import {
  toSqlVector,
  upsertChunkEmbeddings,
  semanticSearchChunks,
  getEmbeddingColumnDimensions,
  alterEmbeddingDimensions,
  deleteItemEmbeddings,
  clearAllEmbeddings,
  getEmbeddingStats,
} from './vector-store';

/** Initial column width created by migration v001. */
const INITIAL_DIM = 1536;

function oneHot(dim: number, hot: number): number[] {
  const v = new Array(dim).fill(0);
  v[hot] = 1;
  return v;
}

// ---------------------------------------------------------------------------
// toSqlVector — pure
// ---------------------------------------------------------------------------

describe('toSqlVector', () => {
  it('serializes to pgvector text literal', () => {
    expect(toSqlVector([1, 2, 3])).toBe('[1,2,3]');
    expect(toSqlVector([])).toBe('[]');
    expect(toSqlVector([0.5, -0.25])).toBe('[0.5,-0.25]');
  });
});

// ---------------------------------------------------------------------------
// dimension guards — pure (no DB needed; guards run before any query)
// ---------------------------------------------------------------------------

describe('upsertChunkEmbeddings dimension guards', () => {
  const fakeDb = {} as unknown as FavbaseDb;

  it('throws EmbeddingDimensionError on a mixed-dimension batch', async () => {
    await expect(
      upsertChunkEmbeddings(fakeDb, [
        { chunkId: 'a', vector: [1, 2, 3] },
        { chunkId: 'b', vector: [1, 2] },
      ]),
    ).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });

  it('throws EmbeddingDimensionLimitError above the HNSW cap', async () => {
    await expect(
      upsertChunkEmbeddings(fakeDb, [
        { chunkId: 'a', vector: new Array(MAX_INDEXABLE_DIMENSIONS + 1).fill(0) },
      ]),
    ).rejects.toBeInstanceOf(EmbeddingDimensionLimitError);
  });

  it('throws EmbeddingDimensionLimitError on empty vectors', async () => {
    await expect(
      upsertChunkEmbeddings(fakeDb, [{ chunkId: 'a', vector: [] }]),
    ).rejects.toBeInstanceOf(EmbeddingDimensionLimitError);
  });
});

// ---------------------------------------------------------------------------
// PGlite roundtrip — real in-memory pgvector, initial 1536 column
// ---------------------------------------------------------------------------

describe('vector store PGlite roundtrip', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let itemId: string;
  let chunkA: string;
  let chunkB: string;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    // Seed an author + item + two chunks (embeddings start NULL).
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'test', platformAuthorId: 'a1', name: 'A' })
      .returning();

    const [item] = await db
      .insert(schema.items)
      .values({
        platform: 'test',
        platformItemId: 'i1',
        authorId: author.id,
        title: 'Item 1',
        authorName: 'A',
        originalUrl: 'http://x',
      })
      .returning();
    itemId = item.id;

    const chunks = await db
      .insert(schema.itemChunks)
      .values([
        { itemId, chunkIndex: 0, chunkText: 'chunk zero' },
        { itemId, chunkIndex: 1, chunkText: 'chunk one' },
      ])
      .returning();
    chunkA = chunks[0].id;
    chunkB = chunks[1].id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it('reads the initial column dimension from the pg catalog', async () => {
    expect(await getEmbeddingColumnDimensions(db)).toBe(INITIAL_DIM);
  });

  it('upserts embeddings and reports stats', async () => {
    await upsertChunkEmbeddings(db, [
      { chunkId: chunkA, vector: oneHot(INITIAL_DIM, 0) },
      { chunkId: chunkB, vector: oneHot(INITIAL_DIM, 1) },
    ]);

    const stats = await getEmbeddingStats(db);
    expect(stats.totalChunks).toBe(2);
    expect(stats.embeddedChunks).toBe(2);
  });

  it('semanticSearchChunks ranks by cosine distance', async () => {
    // Query near dim0 -> chunkA should rank first.
    const query = oneHot(INITIAL_DIM, 0);
    query[0] = 0.9;
    query[1] = 0.1;

    const hits = await semanticSearchChunks(db, query, { topK: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0].chunkId).toBe(chunkA);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[0].itemId).toBe(itemId);
    expect(hits[0].chunkText).toBe('chunk zero');
  });

  it('respects minScore filtering', async () => {
    const query = oneHot(INITIAL_DIM, 0);
    // chunkB (dim1 one-hot) is orthogonal to the query -> score ~0, filtered out.
    const hits = await semanticSearchChunks(db, query, { topK: 2, minScore: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe(chunkA);
  });

  it('rejects query vectors that do not match the column dimension', async () => {
    const err = await semanticSearchChunks(db, [1, 2, 3], { topK: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingDimensionError);
    expect((err as EmbeddingDimensionError).expected).toBe(INITIAL_DIM);
    expect((err as EmbeddingDimensionError).actual).toBe(3);
  });

  it('deleteItemEmbeddings nulls embeddings for the item', async () => {
    await deleteItemEmbeddings(db, itemId);
    const stats = await getEmbeddingStats(db);
    expect(stats.embeddedChunks).toBe(0);
    expect(stats.totalChunks).toBe(2);
  });

  it('clearAllEmbeddings nulls all embeddings', async () => {
    // Re-populate then clear.
    await upsertChunkEmbeddings(db, [{ chunkId: chunkA, vector: oneHot(INITIAL_DIM, 0) }]);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(1);

    await clearAllEmbeddings(db);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lazy dimension switching — the model-follows-column convergence point
// ---------------------------------------------------------------------------

describe('lazy dimension switching (PGlite)', () => {
  const NEW_DIM = 1024;

  let pg: PGlite;
  let db: FavbaseDb;
  let itemEmbedded: string; // will be marked 'embedded' before the switch
  let itemPending: string; // stays at default 'pending' throughout
  let chunk0: string;
  let chunk1: string;
  let chunk2: string; // NOT re-embedded after the switch -> must end up NULL

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'test', platformAuthorId: 'a1', name: 'A' })
      .returning();

    const [a, b] = await db
      .insert(schema.items)
      .values([
        {
          platform: 'test',
          platformItemId: 'i-embedded',
          authorId: author.id,
          title: 'Embedded',
          authorName: 'A',
          originalUrl: 'http://x',
        },
        {
          platform: 'test',
          platformItemId: 'i-pending',
          authorId: author.id,
          title: 'Pending',
          authorName: 'A',
          originalUrl: 'http://y',
        },
      ])
      .returning();
    itemEmbedded = a.id;
    itemPending = b.id;

    const chunks = await db
      .insert(schema.itemChunks)
      .values([
        { itemId: itemEmbedded, chunkIndex: 0, chunkText: 'chunk zero' },
        { itemId: itemEmbedded, chunkIndex: 1, chunkText: 'chunk one' },
        { itemId: itemPending, chunkIndex: 0, chunkText: 'chunk two' },
      ])
      .returning();
    chunk0 = chunks[0].id;
    chunk1 = chunks[1].id;
    chunk2 = chunks[2].id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it('re-dimensions the column, clears old vectors, and reverts embedded items', async () => {
    // 1. Fill all three chunks at the initial dimension; mark one item embedded.
    await upsertChunkEmbeddings(db, [
      { chunkId: chunk0, vector: oneHot(INITIAL_DIM, 0) },
      { chunkId: chunk1, vector: oneHot(INITIAL_DIM, 1) },
      { chunkId: chunk2, vector: oneHot(INITIAL_DIM, 2) },
    ]);
    await db
      .update(schema.items)
      .set({ contentState: 'embedded' })
      .where(eq(schema.items.id, itemEmbedded));

    // 2. Upsert a NEW_DIM batch onto chunk0/chunk1 only -> lazy switch fires.
    await upsertChunkEmbeddings(db, [
      { chunkId: chunk0, vector: oneHot(NEW_DIM, 0) },
      { chunkId: chunk1, vector: oneHot(NEW_DIM, 1) },
    ]);

    // Column now NEW_DIM (atttypmod is the raw dimension).
    expect(await getEmbeddingColumnDimensions(db)).toBe(NEW_DIM);

    // chunk2's old vector was cleared (not converted); chunk0/1 hold new vectors.
    const stats = await getEmbeddingStats(db);
    expect(stats.totalChunks).toBe(3);
    expect(stats.embeddedChunks).toBe(2);
    const [orphan] = await db
      .select({ embedding: schema.itemChunks.embedding })
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.id, chunk2));
    expect(orphan.embedding).toBeNull();

    // 'embedded' item reverted to 'chunked'; other states untouched.
    const states = await db
      .select({ id: schema.items.id, contentState: schema.items.contentState })
      .from(schema.items);
    const byId = Object.fromEntries(states.map((r) => [r.id, r.contentState]));
    expect(byId[itemEmbedded]).toBe('chunked');
    expect(byId[itemPending]).toBe('pending');

    // HNSW index survived the ALTER (PostgreSQL rebuilds it, opclass kept).
    const idx = await db.execute<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'item_chunks' AND indexname = 'idx_item_chunks_embedding'
    `);
    const rows = (idx.rows ?? []) as { indexdef: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('hnsw');
    expect(rows[0].indexdef).toContain('vector_cosine_ops');
  });

  it('cosine search works at the new dimension', async () => {
    const query = oneHot(NEW_DIM, 0);
    query[0] = 0.9;
    query[1] = 0.1;

    const hits = await semanticSearchChunks(db, query, { topK: 3 });
    expect(hits).toHaveLength(2); // chunk2 is NULL, excluded
    expect(hits[0].chunkId).toBe(chunk0);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('rejects stale-dimension query vectors after the switch', async () => {
    const err = await semanticSearchChunks(db, oneHot(INITIAL_DIM, 0), {
      topK: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingDimensionError);
    expect((err as EmbeddingDimensionError).expected).toBe(NEW_DIM);
  });

  it('alterEmbeddingDimensions is a no-op when the dimension already matches', async () => {
    // Double-check path: must NOT clear existing vectors.
    await alterEmbeddingDimensions(db, NEW_DIM);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(2);
    expect(await getEmbeddingColumnDimensions(db)).toBe(NEW_DIM);
  });

  it('rejects dimensions above the HNSW cap without touching the column', async () => {
    await expect(
      alterEmbeddingDimensions(db, MAX_INDEXABLE_DIMENSIONS + 1),
    ).rejects.toBeInstanceOf(EmbeddingDimensionLimitError);
    expect(await getEmbeddingColumnDimensions(db)).toBe(NEW_DIM);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(2);
  });

  it('rejects non-integer and sub-1 dimensions', async () => {
    await expect(alterEmbeddingDimensions(db, 0)).rejects.toBeInstanceOf(
      EmbeddingDimensionLimitError,
    );
    await expect(alterEmbeddingDimensions(db, 12.5)).rejects.toBeInstanceOf(
      EmbeddingDimensionLimitError,
    );
    expect(await getEmbeddingColumnDimensions(db)).toBe(NEW_DIM);
  });
});
