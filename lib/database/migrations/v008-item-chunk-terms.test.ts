import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { runMigrations } from './index';
import { up } from './v008-item-chunk-terms';
import { segmentWords } from '../text-search';

/** More than two backfill batches (2000 each), so the keyset walk is exercised. */
const CHUNKS = 4003;
/** `chunk_index` of the one chunk whose text segments to nothing. */
const NO_WORDS_INDEX = CHUNKS - 1;

/**
 * The upgrade path: a library written before v008 has chunks and no terms
 * table. Built by running every migration, then undoing v008 and writing
 * chunks the way pre-v008 code did (no terms rows).
 */
describe('migration v008: item_chunk_terms backfill', () => {
  let pg: PGlite;

  async function count(query: string): Promise<number> {
    const { rows } = await pg.query<{ n: number }>(query);
    return Number(rows[0].n);
  }

  /** Chunks with no terms row, and chunks with more than one. */
  async function unindexedAndDuplicated(): Promise<[number, number]> {
    return [
      await count(
        `SELECT count(*) AS n FROM item_chunks c
         WHERE NOT EXISTS (SELECT 1 FROM item_chunk_terms t WHERE t.chunk_id = c.id)`,
      ),
      await count(
        `SELECT count(*) AS n FROM (
           SELECT chunk_id FROM item_chunk_terms GROUP BY chunk_id HAVING count(*) > 1
         ) AS d`,
      ),
    ];
  }

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    await pg.exec(`
      DROP TABLE item_chunk_terms;
      DELETE FROM _migrations WHERE version = 8;
    `);

    const { rows: [author] } = await pg.query<{ id: string }>(
      `INSERT INTO authors (platform, platform_author_id, name) VALUES ('test', 'a1', 'A') RETURNING id`,
    );
    const { rows: [item] } = await pg.query<{ id: string }>(
      `INSERT INTO items (platform, platform_item_id, author_id, title, author_name, original_url)
       VALUES ('test', 'i1', $1, 'T', 'A', 'http://x') RETURNING id`,
      [author.id],
    );
    // Quotes and backslashes too: the backfill ships text through array params.
    await pg.query(
      `INSERT INTO item_chunks (item_id, chunk_index, chunk_text)
       SELECT $1, g, '大模型微调 it''s a "chunk" C:\\path ' || g FROM generate_series(0, ${CHUNKS - 2}) AS g`,
      [item.id],
    );
    // The last chunk has no word-like segment at all.
    await pg.query(
      `INSERT INTO item_chunks (item_id, chunk_index, chunk_text) VALUES ($1, $2, $3)`,
      [item.id, NO_WORDS_INDEX, '!!! 😀👍 ……'],
    );
  });

  afterAll(async () => {
    await pg.close();
  });

  it('backfills exactly one terms row per pre-existing chunk, across batches', async () => {
    await runMigrations(pg);

    expect(await count('SELECT count(*) AS n FROM item_chunk_terms')).toBe(CHUNKS);
    expect(await unindexedAndDuplicated()).toEqual([0, 0]);
    expect(
      await count(`SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'idx_item_chunk_terms_tsv'`),
    ).toBe(1);
  });

  it('indexes the same lexemes the chunk writer would', async () => {
    const { rows } = await pg.query<{ chunk_text: string; tsv: string }>(
      `SELECT c.chunk_text, t.tsv::text AS tsv
       FROM item_chunks c JOIN item_chunk_terms t ON t.chunk_id = c.id
       WHERE c.chunk_index = 7`,
    );
    const { rows: expected } = await pg.query<{ tsv: string }>(
      `SELECT to_tsvector('simple', $1)::text AS tsv`,
      [segmentWords(rows[0].chunk_text)],
    );

    expect(rows[0].tsv).toBe(expected[0].tsv);
    expect(rows[0].tsv).toContain("'微调'");
  });

  it('gives a chunk with no words an empty row rather than skipping it', async () => {
    // One row per chunk, words or not, the same contract `replaceItemChunks`
    // asserts; `to_tsvector` of '' is an empty tsvector, which NOT NULL accepts.
    const { rows } = await pg.query<{ tsv: string | null }>(
      `SELECT t.tsv::text AS tsv
       FROM item_chunks c LEFT JOIN item_chunk_terms t ON t.chunk_id = c.id
       WHERE c.chunk_index = $1`,
      [NO_WORDS_INDEX],
    );

    expect(rows).toEqual([{ tsv: '' }]);
  });

  it('is idempotent: migrating again and re-running v008 add nothing', async () => {
    await runMigrations(pg);
    await up(pg);

    expect(await count('SELECT count(*) AS n FROM item_chunk_terms')).toBe(CHUNKS);
    expect(await unindexedAndDuplicated()).toEqual([0, 0]);
    expect(
      await count(`SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'idx_item_chunk_terms_tsv'`),
    ).toBe(1);
  });

  it('resumes a backfill that was cut short', async () => {
    await pg.exec(`DELETE FROM item_chunk_terms WHERE chunk_id IN (
      SELECT id FROM item_chunks WHERE chunk_index % 3 = 0
    )`);
    expect((await unindexedAndDuplicated())[0]).toBeGreaterThan(0);

    await up(pg);

    expect(await count('SELECT count(*) AS n FROM item_chunk_terms')).toBe(CHUNKS);
    expect(await unindexedAndDuplicated()).toEqual([0, 0]);
  });

  it('deleting a chunk deletes its terms row', async () => {
    await pg.exec(`DELETE FROM item_chunks WHERE chunk_index < 3`);

    expect(await count('SELECT count(*) AS n FROM item_chunk_terms')).toBe(CHUNKS - 3);
    expect(await unindexedAndDuplicated()).toEqual([0, 0]);
  });
});
