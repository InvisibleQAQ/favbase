import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import { getAllProcessingCoverage, getProcessingCoverage } from './processing-coverage';
import { COLLECTION_PLATFORMS } from './platforms';

describe('processing coverage (in-memory PGlite)', () => {
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

  describe('getAllProcessingCoverage', () => {
    it('returns a zero snapshot for every platform when nothing is persisted', async () => {
      const all = await getAllProcessingCoverage(db);

      expect(Object.keys(all).sort()).toEqual([...COLLECTION_PLATFORMS].sort());
      for (const platform of COLLECTION_PLATFORMS) {
        expect(all[platform]).toEqual({
          acquisition: { done: 0, total: null },
          content: { done: 0, total: 0 },
          embedding: { done: 0, total: 0 },
          tagging: { done: 0, total: 0 },
        });
      }
    });

    it('matches the scoped reader for every platform, seeded or not', async () => {
      await seedItems('github', [
        { id: 'gh-chunked', contentState: 'chunked' },
        { id: 'gh-embedded', contentState: 'embedded' },
        { id: 'gh-pending', contentState: 'pending' },
      ]);
      await seedItems('bilibili', [
        { id: 'bl-valid', contentState: 'embedded', platformMeta: { attr: 0 } },
        { id: 'bl-invalid', contentState: 'embedded', platformMeta: { attr: 9 } },
      ]);
      const zhihuIds = await seedItems('zhihu', [
        { id: 'zh-embedded', contentState: 'embedded' },
        { id: 'zh-no-content', contentState: 'no_content' },
      ]);
      const tag = await db
        .insert(schema.tags)
        .values({ name: 'covered' })
        .returning({ id: schema.tags.id });
      await db.insert(schema.itemTags).values({ itemId: zhihuIds['zh-embedded'], tagId: tag[0].id });

      const all = await getAllProcessingCoverage(db);

      for (const platform of COLLECTION_PLATFORMS) {
        await expect(getProcessingCoverage(platform, db)).resolves.toEqual(all[platform]);
      }
    });

    it('keeps downstream-ineligible items in the acquisition count', async () => {
      // The eligibility predicate belongs in the stage `filter`s only. An
      // invalid Bilibili video is excluded from content/embedding/tagging but
      // was still fetched, so hoisting that predicate to `WHERE` — which would
      // drop the row from `count(*)` too — is the bug this locks down.
      await seedItems('bilibili', [
        { id: 'valid', contentState: 'chunked', platformMeta: { attr: 0 } },
        { id: 'invalid-a', contentState: 'embedded', platformMeta: { attr: 9 } },
        { id: 'invalid-b', contentState: 'embedded', platformMeta: { attr: 9 } },
      ]);

      const all = await getAllProcessingCoverage(db);

      expect(all.bilibili.acquisition).toEqual({ done: 3, total: null });
      expect(all.bilibili.content.total).toBe(1);
      expect(all.bilibili.embedding.total).toBe(1);
    });

    it('scopes each platform to its own rows', async () => {
      await seedItems('github', [{ id: 'gh', contentState: 'embedded' }]);
      await seedItems('x', [
        { id: 'x-1', contentState: 'chunked' },
        { id: 'x-2', contentState: 'pending' },
      ]);

      const all = await getAllProcessingCoverage(db);

      expect(all.github.acquisition.done).toBe(1);
      expect(all.x.acquisition.done).toBe(2);
      expect(all.bookmarks.acquisition.done).toBe(0);
      expect(all.youtube.acquisition.done).toBe(0);
    });
  });
});
