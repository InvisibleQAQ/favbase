import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { upsertChunkEmbeddings } from '@/lib/embedding/vector-store';
import { hybridRetrieve } from './retrieval';
import type { RetrievalDeps } from './types';

// Every test injects `embedQuery`, so the default embedder (which lazy-imports
// `@/lib/embedding/config` → WXT storage) never loads. No storage mock needed.

const INITIAL_DIM = 1536;

function oneHot(hot: number): number[] {
  const v = new Array(INITIAL_DIM).fill(0);
  v[hot] = 1;
  return v;
}

const NO_EMBED: RetrievalDeps = { embedQuery: async () => null };

describe('hybridRetrieve (PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let itemBili: string;
  let itemGh: string;
  let chunkBili: string; // bilibili chunk containing 机器学习
  let chunkBiliOther: string; // bilibili chunk, no match
  let chunkGh: string; // github chunk containing 机器学习 + learning
  let tagId: string;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'test', platformAuthorId: 'a1', name: 'A' })
      .returning();

    const [bili, gh] = await db
      .insert(schema.items)
      .values([
        {
          platform: 'bilibili',
          platformItemId: 'BV1',
          authorId: author.id,
          title: 'ML video',
          authorName: 'A',
          originalUrl: 'http://b/1',
          contentState: 'embedded',
        },
        {
          platform: 'github',
          platformItemId: 'owner/repo',
          authorId: author.id,
          title: 'ML repo',
          authorName: 'A',
          originalUrl: 'http://g/1',
          contentState: 'embedded',
        },
      ])
      .returning();
    itemBili = bili.id;
    itemGh = gh.id;

    const chunks = await db
      .insert(schema.itemChunks)
      .values([
        { itemId: itemBili, chunkIndex: 0, chunkText: '机器学习是人工智能的核心分支' },
        { itemId: itemBili, chunkIndex: 1, chunkText: '今天的天气非常好适合出门' },
        { itemId: itemGh, chunkIndex: 0, chunkText: '机器学习 machine learning tutorial' },
      ])
      .returning();
    chunkBili = chunks[0].id;
    chunkBiliOther = chunks[1].id;
    chunkGh = chunks[2].id;

    // Embeddings (one-hot) so an injected query vector can target a chunk.
    await upsertChunkEmbeddings(db, [
      { chunkId: chunkBili, vector: oneHot(0) },
      { chunkId: chunkBiliOther, vector: oneHot(1) },
      { chunkId: chunkGh, vector: oneHot(2) },
    ]);

    // Tag only the bilibili item.
    const [tag] = await db.insert(schema.tags).values({ name: 'ai' }).returning();
    tagId = tag.id;
    await db.insert(schema.itemTags).values({ itemId: itemBili, tagId });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('returns [] for a blank query without touching the DB', async () => {
    expect(await hybridRetrieve(db, '   ', {}, NO_EMBED)).toEqual([]);
  });

  it('keyword-only arm (embedding disabled) finds substring matches', async () => {
    const hits = await hybridRetrieve(db, '人工智能', {}, NO_EMBED);
    expect(hits.length).toBe(1);
    expect(hits[0].chunkId).toBe(chunkBili);
    expect(hits[0].item.platform).toBe('bilibili');
    expect(hits[0].item.url).toBe('http://b/1');
    expect(hits[0].chunkText).toContain('机器学习');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('fuses both arms; a chunk hit by both ranks first', async () => {
    // Query vector targets the bilibili chunk (dim 0); minScore drops the
    // orthogonal chunks so the semantic arm returns only chunkBili. Keyword
    // '机器学习' hits both chunks. chunkBili is in BOTH arms -> ranks first.
    const deps: RetrievalDeps = { embedQuery: async () => oneHot(0) };
    const hits = await hybridRetrieve(db, '机器学习', { topK: 5, minScore: 0.5 }, deps);

    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain(chunkBili);
    expect(ids).toContain(chunkGh);
    expect(hits[0].chunkId).toBe(chunkBili);
  });

  it('degrades to keyword-only on a query/column dimension mismatch', async () => {
    // Wrong-width vector -> semanticSearchChunks throws EmbeddingDimensionError,
    // caught internally; keyword arm still returns results, no throw.
    const deps: RetrievalDeps = { embedQuery: async () => [1, 2, 3] };
    const hits = await hybridRetrieve(db, '机器学习', {}, deps);
    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain(chunkBili);
    expect(ids).toContain(chunkGh);
  });

  it('applies the platform filter in SQL', async () => {
    const hits = await hybridRetrieve(db, '机器学习', { platform: 'github' }, NO_EMBED);
    expect(hits.length).toBe(1);
    expect(hits[0].chunkId).toBe(chunkGh);
    expect(hits[0].item.platform).toBe('github');
  });

  it('applies the tag filter in SQL', async () => {
    // Only the bilibili item carries the tag, so the github chunk is dropped
    // even though it also matches '机器学习'.
    const hits = await hybridRetrieve(db, '机器学习', { tagId }, NO_EMBED);
    expect(hits.every((h) => h.item.platform === 'bilibili')).toBe(true);
    expect(hits.map((h) => h.chunkId)).toContain(chunkBili);
    expect(hits.map((h) => h.chunkId)).not.toContain(chunkGh);
  });

  it('returns [] when nothing matches', async () => {
    const hits = await hybridRetrieve(db, 'zzz-no-such-token-zzz', {}, NO_EMBED);
    expect(hits).toEqual([]);
  });

  it('never selects the non-matching chunk', async () => {
    const hits = await hybridRetrieve(db, '机器学习', {}, NO_EMBED);
    expect(hits.map((h) => h.chunkId)).not.toContain(chunkBiliOther);
  });
});
