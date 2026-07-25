import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import { getProcessingCoverage } from './processing-coverage';

describe('getProcessingCoverage (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
  });

  afterAll(async () => {
    await pg.close();
  });

  afterEach(async () => {
    await db.delete(schema.itemTags);
    await db.delete(schema.tags);
    await db.delete(schema.items);
    await db.delete(schema.authors);
  });

  async function seedItems(
    platform: string,
    rows: Array<{ id: string; contentState: string; platformMeta?: Record<string, unknown> }>,
  ): Promise<Record<string, string>> {
    const author = await db
      .insert(schema.authors)
      .values({ platform, platformAuthorId: `${platform}-author`, name: 'Author' })
      .returning({ id: schema.authors.id });
    const inserted = await db
      .insert(schema.items)
      .values(
        rows.map((row) => ({
          platform,
          platformItemId: row.id,
          authorId: author[0].id,
          authorName: 'Author',
          title: row.id,
          originalUrl: `https://example.test/${row.id}`,
          contentState: row.contentState,
          platformMeta: row.platformMeta ?? {},
        })),
      )
      .returning({ id: schema.items.id, platformItemId: schema.items.platformItemId });
    return Object.fromEntries(inserted.map((row) => [row.platformItemId, row.id]));
  }

  it('returns a zero idle snapshot for an empty platform library', async () => {
    await expect(getProcessingCoverage('github', db)).resolves.toEqual({
      acquisition: { done: 0, total: null },
      content: { done: 0, total: 0 },
      embedding: { done: 0, total: 0 },
      tagging: { done: 0, total: 0 },
    });
  });

  it('counts settled content, item-level embeddings, and final tag coverage', async () => {
    const ids = await seedItems('github', [
      { id: 'pending', contentState: 'pending' },
      { id: 'has-content', contentState: 'has_content' },
      { id: 'chunked', contentState: 'chunked' },
      { id: 'embedded', contentState: 'embedded' },
      { id: 'no-content', contentState: 'no_content' },
      { id: 'error', contentState: 'error' },
    ]);
    const tag = await db
      .insert(schema.tags)
      .values({ name: 'covered' })
      .returning({ id: schema.tags.id });
    await db.insert(schema.itemTags).values({ itemId: ids.chunked, tagId: tag[0].id });

    await expect(getProcessingCoverage('github', db)).resolves.toEqual({
      acquisition: { done: 6, total: null },
      content: { done: 4, total: 6 },
      embedding: { done: 1, total: 2 },
      tagging: { done: 1, total: 2 },
    });
  });

  it('excludes invalid Bilibili videos from every downstream denominator', async () => {
    await seedItems('bilibili', [
      { id: 'valid', contentState: 'chunked', platformMeta: { attr: 0 } },
      { id: 'invalid', contentState: 'embedded', platformMeta: { attr: 9 } },
    ]);

    await expect(getProcessingCoverage('bilibili', db)).resolves.toEqual({
      acquisition: { done: 2, total: null },
      content: { done: 1, total: 1 },
      embedding: { done: 0, total: 1 },
      tagging: { done: 0, total: 1 },
    });
  });
});
