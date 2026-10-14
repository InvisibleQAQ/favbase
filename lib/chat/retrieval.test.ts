import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { replaceItemChunks, upsertChunkEmbeddings } from '@/lib/embedding/vector-store';
import { hybridRetrieve } from './retrieval';
import type { RetrievalDeps } from './types';

// Every test injects `embedQuery`, so the default embedder never runs. Its
// `@/lib/embedding/config` import is static (a Service Worker cannot
// dynamic-import) but storage-free at load time, so no mock is needed.

const INITIAL_DIM = 1536;

function oneHot(hot: number): number[] {
  const v = new Array(INITIAL_DIM).fill(0);
  v[hot] = 1;
  return v;
}

const NO_EMBED: RetrievalDeps = { embedQuery: async () => null };

// ---------------------------------------------------------------------------
// Shared seeding: one item per call, its chunks written through the real chunk
// writer, so each chunk gets the keyword-index row the keyword arm searches.
// ---------------------------------------------------------------------------

interface SeedChunk {
  text: string;
  embedding?: number[];
}

async function createDb(): Promise<{ pg: PGlite; db: FavbaseDb }> {
  const pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
  await runMigrations(pg);
  return { pg, db: drizzle({ client: pg, schema }) as unknown as FavbaseDb };
}

async function seedAuthor(db: FavbaseDb): Promise<string> {
  const [author] = await db
    .insert(schema.authors)
    .values({ platform: 'test', platformAuthorId: 'a1', name: 'A' })
    .returning();
  return author.id;
}

async function seedItem(
  db: FavbaseDb,
  authorId: string,
  platform: string,
  key: string,
  chunks: SeedChunk[],
): Promise<{ itemId: string; chunkIds: string[] }> {
  const [item] = await db
    .insert(schema.items)
    .values({
      platform,
      platformItemId: key,
      authorId,
      title: key,
      authorName: 'A',
      originalUrl: `http://test/${key}`,
    })
    .returning();
  const inserted = await replaceItemChunks(
    db,
    item.id,
    chunks.map((c) => ({ text: c.text })),
  );
  const embedded = inserted.flatMap((row, i) => {
    const embedding = chunks[i].embedding;
    return embedding ? [{ chunkId: row.id, vector: embedding }] : [];
  });
  await upsertChunkEmbeddings(db, embedded);
  return { itemId: item.id, chunkIds: inserted.map((r) => r.id) };
}

describe('hybridRetrieve (PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let chunkBili: string; // bilibili chunk containing 机器学习
  let chunkBiliOther: string; // bilibili chunk, no match
  let chunkGh: string; // github chunk containing 机器学习 + learning
  let tagId: string;

  beforeAll(async () => {
    ({ pg, db } = await createDb());
    const author = await seedAuthor(db);

    const bili = await seedItem(db, author, 'bilibili', 'BV1', [
      { text: '机器学习是人工智能的核心分支', embedding: oneHot(0) },
      { text: '今天的天气非常好适合出门', embedding: oneHot(1) },
    ]);
    const gh = await seedItem(db, author, 'github', 'owner/repo', [
      { text: '机器学习 machine learning tutorial', embedding: oneHot(2) },
    ]);
    [chunkBili, chunkBiliOther] = bili.chunkIds;
    [chunkGh] = gh.chunkIds;

    // Tag only the bilibili item.
    const [tag] = await db.insert(schema.tags).values({ name: 'ai' }).returning();
    tagId = tag.id;
    await db.insert(schema.itemTags).values({ itemId: bili.itemId, tagId });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('returns nothing for a blank query without touching the DB', async () => {
    expect(await hybridRetrieve(db, '   ', {}, NO_EMBED)).toEqual({
      hits: [],
      queryTerms: [],
      semanticSearch: false,
    });
  });

  it('keyword-only arm (embedding disabled) finds word matches', async () => {
    const { hits } = await hybridRetrieve(db, '人工智能', {}, NO_EMBED);
    expect(hits.length).toBe(1);
    expect(hits[0].chunkId).toBe(chunkBili);
    expect(hits[0].item.platform).toBe('bilibili');
    expect(hits[0].item.url).toBe('http://test/BV1');
    expect(hits[0].chunkText).toContain('机器学习');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('fuses both arms; a chunk hit by both ranks first', async () => {
    // Query vector targets the bilibili chunk (dim 0); minScore drops the
    // orthogonal chunks so the semantic arm returns only chunkBili. Keyword
    // '机器学习' hits both chunks. chunkBili is in BOTH arms -> ranks first.
    const deps: RetrievalDeps = { embedQuery: async () => oneHot(0) };
    const { hits } = await hybridRetrieve(db, '机器学习', { topK: 5, minScore: 0.5 }, deps);

    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain(chunkBili);
    expect(ids).toContain(chunkGh);
    expect(hits[0].chunkId).toBe(chunkBili);
  });

  it('degrades to keyword-only on a query/column dimension mismatch', async () => {
    // Wrong-width vector -> semanticSearchChunks throws EmbeddingDimensionError,
    // caught internally; keyword arm still returns results, no throw.
    const deps: RetrievalDeps = { embedQuery: async () => [1, 2, 3] };
    const { hits, semanticSearch } = await hybridRetrieve(db, '机器学习', {}, deps);
    const ids = hits.map((h) => h.chunkId);
    expect(ids).toContain(chunkBili);
    expect(ids).toContain(chunkGh);
    expect(semanticSearch).toBe(false);
    expect(hits.every((h) => h.similarity === null)).toBe(true);
  });

  it('applies the platform filter in SQL', async () => {
    const { hits } = await hybridRetrieve(db, '机器学习', { platform: 'github' }, NO_EMBED);
    expect(hits.length).toBe(1);
    expect(hits[0].chunkId).toBe(chunkGh);
    expect(hits[0].item.platform).toBe('github');
  });

  it('applies the tag filter in SQL', async () => {
    // Only the bilibili item carries the tag, so the github chunk is dropped
    // even though it also matches '机器学习'.
    const { hits } = await hybridRetrieve(db, '机器学习', { tagId }, NO_EMBED);
    expect(hits.every((h) => h.item.platform === 'bilibili')).toBe(true);
    expect(hits.map((h) => h.chunkId)).toContain(chunkBili);
    expect(hits.map((h) => h.chunkId)).not.toContain(chunkGh);
  });

  it('returns nothing, and no query terms, when no query word occurs', async () => {
    expect(await hybridRetrieve(db, 'zzz-no-such-token-zzz', {}, NO_EMBED)).toEqual({
      hits: [],
      queryTerms: [],
      semanticSearch: false,
    });
  });

  it('never selects the non-matching chunk', async () => {
    const { hits } = await hybridRetrieve(db, '机器学习', {}, NO_EMBED);
    expect(hits.map((h) => h.chunkId)).not.toContain(chunkBiliOther);
  });

  describe('evidence fields', () => {
    it('reports the segmented query terms and the terms each hit matched', async () => {
      const { hits, queryTerms } = await hybridRetrieve(db, '机器学习', {}, NO_EMBED);

      expect([...queryTerms].sort()).toEqual(['学习', '机器'].sort());
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.matchedTerms.length).toBeGreaterThan(0);
        expect(queryTerms).toEqual(expect.arrayContaining(hit.matchedTerms));
      }
    });

    it('gives a keyword-only hit its cosine too, and a semantic-only hit no matched terms', async () => {
      // minScore keeps the semantic arm to chunkBili (cosine 1). chunkGh is
      // found by the keyword arm alone; its vector is orthogonal (cosine 0).
      // chunkBiliOther shares no word with the query, so only a semantic
      // arm without the floor could find it.
      const deps: RetrievalDeps = { embedQuery: async () => oneHot(0) };
      const { hits, semanticSearch } = await hybridRetrieve(
        db,
        '机器学习',
        { topK: 5, minScore: 0.5 },
        deps,
      );
      // `toBeCloseTo(0)` alone passes on `null` (it coerces), so the type is
      // asserted first.
      const similarityOf = (found: typeof hits, chunkId: string) => {
        const similarity = found.find((h) => h.chunkId === chunkId)?.similarity;
        expect(similarity, chunkId).toEqual(expect.any(Number));
        return similarity as number;
      };

      expect(semanticSearch).toBe(true);
      expect(similarityOf(hits, chunkBili)).toBeCloseTo(1, 5);
      expect(similarityOf(hits, chunkGh)).toBeCloseTo(0, 5);

      const semanticOnly = await hybridRetrieve(
        db,
        '天气',
        { topK: 5 },
        { embedQuery: async () => oneHot(1) },
      );
      expect(similarityOf(semanticOnly.hits, chunkBiliOther)).toBeCloseTo(1, 5);
      expect(semanticOnly.hits.find((h) => h.chunkId === chunkBiliOther)?.matchedTerms).toEqual(['天气']);
      expect(similarityOf(semanticOnly.hits, chunkGh)).toBeCloseTo(0, 5);
      expect(semanticOnly.hits.find((h) => h.chunkId === chunkGh)?.matchedTerms).toEqual([]);
    });

    it('reports no semantic search and null similarity when embedding is off', async () => {
      const { hits, semanticSearch } = await hybridRetrieve(db, '机器学习', {}, NO_EMBED);

      expect(semanticSearch).toBe(false);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.similarity === null)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Keyword arm: word semantics, rarity, pruning, phrases (embedding disabled)
// ---------------------------------------------------------------------------

describe('hybridRetrieve keyword arm (PGlite)', () => {
  /**
   * Above 30% of the library and above both keyword budgets at topK 10 (30
   * chunks unscoped, 50 scoped), so `common` is pruned whenever its df counts
   * the whole library. Inside the github scope it occurs once.
   */
  const COMMON_FILLERS = 60;

  let pg: PGlite;
  let db: FavbaseDb;
  let bothWords: string; // 'Rust' + 'async', non-adjacent
  let rustOnly: string;
  let trustAsync: string; // 'trust' (not 'rust') + 'async'
  let trustOnly: string; // 'trust' alone: a substring match, not a word match
  let compound: string; // 大模型微调 adjacent, no 教程
  let separated: string; // 微调 … 大模型 … 教程
  let rareCommon: string; // 'common' + 'rare'
  let githubCommon: string; // the one 'common' chunk in the github scope
  const fillers: string[] = [];

  beforeAll(async () => {
    ({ pg, db } = await createDb());
    const author = await seedAuthor(db);
    const one = async (platform: string, key: string, text: string) =>
      (await seedItem(db, author, platform, key, [{ text }])).chunkIds[0];

    bothWords = await one('github', 'kw-both', 'Rust lets you write async code without a garbage collector');
    rustOnly = await one('github', 'kw-rust', 'Rust ownership and borrowing explained');
    trustAsync = await one('x', 'kw-trust-async', 'I trust this async library');
    trustOnly = await one('x', 'kw-trust', 'trust but verify');
    compound = await one('bilibili', 'kw-compound', '这篇讲大模型微调的实战经验');
    separated = await one('bilibili', 'kw-separated', '微调是常见做法，大模型的教程也需要');
    rareCommon = await one('x', 'kw-rare', 'common rare gem');
    githubCommon = await one('github', 'kw-github-common', 'common github words');
    for (let i = 0; i < COMMON_FILLERS; i++) {
      fillers.push(await one('x', `kw-filler-${i}`, `common filler ${i}`));
    }
  });

  afterAll(async () => {
    await pg.close();
  });

  it('matches words, not substrings, and ranks a chunk holding both words first', async () => {
    const { hits } = await hybridRetrieve(db, 'Rust async', { topK: 10 }, NO_EMBED);
    const ids = hits.map((h) => h.chunkId);

    expect(ids[0]).toBe(bothWords);
    expect(ids).toContain(rustOnly);
    // `trust` holds `rust` as a substring; as a word it is something else.
    expect(ids).not.toContain(trustOnly);
    expect(ids.indexOf(trustAsync)).toBeGreaterThan(0);
    expect(hits.find((h) => h.chunkId === trustAsync)?.matchedTerms).toEqual(['async']);
    expect(hits[0].matchedTerms).toEqual(['async', 'rust']);
  });

  it('segments an unspaced Chinese query and ranks the adjacent compound above the separated words', async () => {
    const { hits, queryTerms } = await hybridRetrieve(db, '大模型微调', { topK: 10 }, NO_EMBED);
    const ids = hits.map((h) => h.chunkId);

    expect([...queryTerms].sort()).toEqual(['大', '模型', '微调'].sort());
    expect(ids).toContain(separated);
    expect(ids.indexOf(compound)).toBeLessThan(ids.indexOf(separated));
  });

  it('lets the phrase bonus outrank a chunk that holds one more query word', async () => {
    // The separated chunk holds all four words, the compound one only three,
    // so without the bonus the separated chunk wins. The bonus adds the
    // run's idf sum again for holding 大 模型 微调 adjacently.
    const { hits } = await hybridRetrieve(db, '大模型微调 教程', { topK: 10 }, NO_EMBED);
    const ids = hits.map((h) => h.chunkId);

    expect(hits.find((h) => h.chunkId === separated)?.matchedTerms).toHaveLength(4);
    expect(ids.slice(0, 2)).toEqual([compound, separated]);
  });

  it('a word above the document-frequency ratio neither recalls nor scores', async () => {
    const { hits, queryTerms } = await hybridRetrieve(db, 'common rare', { topK: 10 }, NO_EMBED);

    expect(queryTerms).toEqual(['rare']);
    expect(hits.map((h) => h.chunkId)).toEqual([rareCommon]);
    expect(hits[0].matchedTerms).toEqual(['rare']);
  });

  it('counts document frequency inside the scope', async () => {
    // Unscoped, `common` is in most chunks and is pruned. In the github scope
    // it is in one chunk of several, so it is the word to search by.
    const unscoped = await hybridRetrieve(db, 'common', { topK: 10 }, NO_EMBED);
    const scoped = await hybridRetrieve(db, 'common', { topK: 10, platform: 'github' }, NO_EMBED);

    expect(unscoped.hits).toEqual([]);
    expect(unscoped.queryTerms).toEqual([]);
    expect(scoped.hits.map((h) => h.chunkId)).toEqual([githubCommon]);
    expect(scoped.queryTerms).toEqual(['common']);
    expect(fillers).not.toContain(scoped.hits[0].chunkId);
  });
});

// ---------------------------------------------------------------------------
// Query text that is tsquery syntax, quoting, or no words at all
// ---------------------------------------------------------------------------

describe('hybridRetrieve keyword arm on hostile query text (PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let operators: string; // holds every word the operator queries spell
  let mixed: string; // CJK and Latin with no spaces between them

  beforeAll(async () => {
    ({ pg, db } = await createDb());
    const author = await seedAuthor(db);
    const one = async (key: string, text: string) =>
      (await seedItem(db, author, 'x', key, [{ text }])).chunkIds[0];

    operators = await one('ops', "a & b | !c foo:* o'reilly C:\\path (x) <-> y");
    mixed = await one('mixed', '用LoRA微调Qwen2.5-7B，显存只要24GB');
    // `foobar` would match `foo:*` read as a prefix query, and this chunk
    // would match `!c` read as a negation.
    await one('decoy', 'foobar prefix decoy only');
    // Segments to nothing: an empty tsvector row sits in every scan below.
    await one('no-words', '!!! 😀👍 ……');
  });

  afterAll(async () => {
    await pg.close();
  });

  it.each(['<->', "'", "''", '\\', '(', ')', ':', '!!!', '😀👍', '& | !', '%_'])(
    'a query with no words (%j) searches nothing and does not throw',
    async (query) => {
      expect(await hybridRetrieve(db, query, {}, NO_EMBED)).toEqual({
        hits: [],
        queryTerms: [],
        semanticSearch: false,
      });
    },
  );

  it.each([
    ['a & b | !c', ['a', 'b', 'c']],
    ['foo:*', ['foo']],
    ["o'reilly", ['o', 'reilly']],
    ['C:\\path', ['c', 'path']],
    ['(x) <-> y', ['x', 'y']],
  ])('reads tsquery operators and quotes in %j as text, not syntax', async (query, terms) => {
    const { hits, queryTerms } = await hybridRetrieve(db, query, {}, NO_EMBED);

    expect(queryTerms).toEqual(terms);
    expect(hits.map((h) => h.chunkId)).toEqual([operators]);
    expect(hits[0].matchedTerms).toEqual(terms);
  });

  it('segments a mixed CJK and Latin query the way the index was segmented', async () => {
    const { hits, queryTerms } = await hybridRetrieve(db, '用LoRA微调Qwen2.5-7B', {}, NO_EMBED);

    expect([...queryTerms].sort()).toEqual(['7b', 'lora', 'qwen2.5', '微调', '用'].sort());
    expect(hits.map((h) => h.chunkId)).toEqual([mixed]);
  });

  it('gives a hit with no embedding a null similarity even when the semantic arm ran', async () => {
    // The column has its default width, so the arm runs and finds nothing:
    // no chunk here is embedded.
    const { hits, semanticSearch } = await hybridRetrieve(
      db,
      'foo',
      {},
      { embedQuery: async () => oneHot(0) },
    );

    expect(semanticSearch).toBe(true);
    expect(hits.map((h) => h.chunkId)).toEqual([operators]);
    expect(hits[0].similarity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-item dedupe (keyword-only: embedding disabled)
// ---------------------------------------------------------------------------

describe('hybridRetrieve per-item dedupe (PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let kombuchaItem: { itemId: string; chunkIds: string[] }; // three matching chunks
  const kombuchaOthers: string[] = []; // item ids, one matching chunk each

  beforeAll(async () => {
    ({ pg, db } = await createDb());
    const author = await seedAuthor(db);

    // The first two chunks hold both query words and outrank every other
    // chunk; the third ties with the other items' chunks.
    kombuchaItem = await seedItem(db, author, 'youtube', 'kombucha-many', [
      { text: 'kombucha scoby' },
      { text: 'kombucha scoby tea' },
      { text: 'kombucha' },
    ]);
    for (const [i, text] of ['how to make kombucha at home', 'kombucha care guide for beginners'].entries()) {
      kombuchaOthers.push((await seedItem(db, author, 'youtube', `kombucha-${i}`, [{ text }])).itemId);
    }
  });

  afterAll(async () => {
    await pg.close();
  });

  it('returns each item once, carrying its best-scoring chunk', async () => {
    // Per-chunk truncation at 3 would return the many-chunk item's two best
    // chunks plus one more: two items at most.
    const { hits } = await hybridRetrieve(db, 'kombucha scoby', { topK: 3 }, NO_EMBED);

    expect(hits.map((h) => h.item.id)[0]).toBe(kombuchaItem.itemId);
    expect([...hits.slice(1).map((h) => h.item.id)].sort()).toEqual([...kombuchaOthers].sort());
    expect(kombuchaItem.chunkIds.slice(0, 2)).toContain(hits[0].chunkId);
    expect(hits[0].score).toBeCloseTo(1 / 61, 10);
  });

  it('returns every distinct item when there are fewer than topK', async () => {
    const { hits } = await hybridRetrieve(db, 'kombucha scoby', { topK: 10 }, NO_EMBED);

    expect(hits.map((h) => h.item.id)[0]).toBe(kombuchaItem.itemId);
    expect([...hits.map((h) => h.item.id)].sort()).toEqual(
      [kombuchaItem.itemId, ...kombuchaOthers].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Scope filters run inside both arms, so a strict filter cannot be starved
// ---------------------------------------------------------------------------

describe('hybridRetrieve scope filters against closer out-of-scope decoys (PGlite)', () => {
  /**
   * More decoys than the filtered per-arm budget (50 at topK 5), and more than
   * HNSW's default `ef_search` of 40.
   */
  const DECOYS = 60;
  const ONE_ARM = 1 / 61;
  const BOTH_ARMS = 2 / 61;

  let pg: PGlite;
  let db: FavbaseDb;
  let target: string;
  let tagId: string;

  const queryVector = () => oneHot(0);
  const deps: RetrievalDeps = { embedQuery: async () => queryVector() };

  beforeAll(async () => {
    ({ pg, db } = await createDb());
    const author = await seedAuthor(db);

    // Target: cosine 0.707 to the query.
    const targetVector = oneHot(0);
    targetVector[1] = 1;
    const seeded = await seedItem(db, author, 'bilibili', 'target', [
      { text: 'a long walkthrough of sourdough starter feeding schedules', embedding: targetVector },
    ]);
    target = seeded.chunkIds[0];
    const [tag] = await db.insert(schema.tags).values({ name: 'baking' }).returning();
    tagId = tag.id;
    await db.insert(schema.itemTags).values({ itemId: seeded.itemId, tagId });

    // Decoys: another platform, untagged, the same word, and cosine 0.995 to
    // the query. One item each, so per-item dedupe keeps them all.
    const decoyItems = await db
      .insert(schema.items)
      .values(
        Array.from({ length: DECOYS }, (_, i) => ({
          platform: 'x',
          platformItemId: `decoy-${i}`,
          authorId: author,
          title: `decoy-${i}`,
          authorName: 'A',
          originalUrl: `http://test/decoy-${i}`,
        })),
      )
      .returning({ id: schema.items.id });
    const decoyEmbeddings = [];
    for (const [i, { id }] of decoyItems.entries()) {
      const [chunk] = await replaceItemChunks(db, id, [
        { text: `sourdough ${String(i).padStart(2, '0')}` },
      ]);
      const decoyVector = oneHot(0);
      decoyVector[2 + i] = 0.1;
      decoyEmbeddings.push({ chunkId: chunk.id, vector: decoyVector });
    }
    await upsertChunkEmbeddings(db, decoyEmbeddings);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('the decoys outrank the target when unfiltered (fixture sanity)', async () => {
    const { hits } = await hybridRetrieve(db, 'sourdough', { topK: 20 }, deps);

    expect(hits).toHaveLength(20);
    expect(hits.every((h) => h.item.platform === 'x')).toBe(true);
  });

  it('a platform filter still finds the target, credited by both arms', async () => {
    const { hits } = await hybridRetrieve(db, 'sourdough', { topK: 5, platform: 'bilibili' }, deps);

    expect(hits.map((h) => h.chunkId)).toEqual([target]);
    expect(hits[0].score).toBeGreaterThan(ONE_ARM);
    expect(hits[0].score).toBeCloseTo(BOTH_ARMS, 10);
  });

  it('a tag filter still finds the target, credited by both arms', async () => {
    const { hits } = await hybridRetrieve(db, 'sourdough', { topK: 5, tagId }, deps);

    expect(hits.map((h) => h.chunkId)).toEqual([target]);
    expect(hits[0].score).toBeGreaterThan(ONE_ARM);
    expect(hits[0].score).toBeCloseTo(BOTH_ARMS, 10);
  });

  it('an empty platform list means no platform filter', async () => {
    const unfiltered = await hybridRetrieve(db, 'sourdough', { topK: 5 }, deps);
    const emptyList = await hybridRetrieve(db, 'sourdough', { topK: 5, platform: [] }, deps);

    expect(emptyList).toEqual(unfiltered);
  });
});
