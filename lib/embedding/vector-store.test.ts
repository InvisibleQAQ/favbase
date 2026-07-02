import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { EMBEDDING_DIMENSIONS } from '@/lib/ai';
import { EmbeddingDimensionError } from './errors';
import {
  toSqlVector,
  upsertChunkEmbeddings,
  semanticSearchChunks,
  deleteItemEmbeddings,
  clearAllEmbeddings,
  getEmbeddingStats,
} from './vector-store';

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
// dimension guard — pure (no DB needed)
// ---------------------------------------------------------------------------

describe('upsertChunkEmbeddings dimension guard', () => {
  it('throws EmbeddingDimensionError on off-dimension vector', async () => {
    // db is never touched because the guard runs before any query.
    const fakeDb = {} as unknown as FavbaseDb;
    await expect(
      upsertChunkEmbeddings(fakeDb, [{ chunkId: 'x', vector: [1, 2, 3] }]),
    ).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });
});

// ---------------------------------------------------------------------------
// PGlite roundtrip — real in-memory pgvector
// ---------------------------------------------------------------------------

function vecOfDim(fill: number, dim = EMBEDDING_DIMENSIONS): number[] {
  return new Array(dim).fill(fill);
}

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

  it('upserts embeddings and reports stats', async () => {
    // chunkA points "one-hot" at dim0, chunkB at dim1.
    const vecA = vecOfDim(0);
    vecA[0] = 1;
    const vecB = vecOfDim(0);
    vecB[1] = 1;

    await upsertChunkEmbeddings(db, [
      { chunkId: chunkA, vector: vecA },
      { chunkId: chunkB, vector: vecB },
    ]);

    const stats = await getEmbeddingStats(db);
    expect(stats.totalChunks).toBe(2);
    expect(stats.embeddedChunks).toBe(2);
  });

  it('semanticSearchChunks ranks by cosine distance', async () => {
    // Query near dim0 -> chunkA should rank first.
    const query = vecOfDim(0);
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
    const query = vecOfDim(0);
    query[0] = 1;
    // chunkB (dim1 one-hot) is orthogonal to the query -> score ~0, filtered out.
    const hits = await semanticSearchChunks(db, query, { topK: 2, minScore: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe(chunkA);
  });

  it('deleteItemEmbeddings nulls embeddings for the item', async () => {
    await deleteItemEmbeddings(db, itemId);
    const stats = await getEmbeddingStats(db);
    expect(stats.embeddedChunks).toBe(0);
    expect(stats.totalChunks).toBe(2);
  });

  it('clearAllEmbeddings nulls all embeddings', async () => {
    // Re-populate then clear.
    const vec = vecOfDim(0);
    vec[0] = 1;
    await upsertChunkEmbeddings(db, [{ chunkId: chunkA, vector: vec }]);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(1);

    await clearAllEmbeddings(db);
    expect((await getEmbeddingStats(db)).embeddedChunks).toBe(0);
  });
});
