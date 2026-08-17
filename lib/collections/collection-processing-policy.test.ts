import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import { createCollectionProcessingPolicy } from './collection-processing-policy';

describe('createCollectionProcessingPolicy (in-memory PGlite)', () => {
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
    await db.delete(schema.items);
    await db.delete(schema.tags);
    await db.delete(schema.authors);
  });

  async function seedItem(
    platform: string,
    platformItemId: string,
    options: {
      chunkTexts?: string[];
      contentState?: string;
      platformMeta?: Record<string, unknown>;
      tagged?: boolean;
    } = {},
  ): Promise<string> {
    const [author] = await db
      .insert(schema.authors)
      .values({
        platform,
        platformAuthorId: `${platform}-${platformItemId}`,
        name: 'Author',
      })
      .returning({ id: schema.authors.id });
    const [item] = await db
      .insert(schema.items)
      .values({
        platform,
        platformItemId,
        authorId: author.id,
        authorName: 'Author',
        title: platformItemId,
        originalUrl: `https://example.test/${platformItemId}`,
        contentState: options.contentState ?? 'pending',
        platformMeta: options.platformMeta ?? {},
      })
      .returning({ id: schema.items.id });
    if (options.chunkTexts?.length) {
      await db.insert(schema.itemChunks).values(
        options.chunkTexts.map((chunkText, chunkIndex) => ({
          itemId: item.id,
          chunkIndex,
          chunkText,
        })),
      );
    }
    if (options.tagged) {
      const [tag] = await db
        .insert(schema.tags)
        .values({ name: `tag-${platformItemId}` })
        .returning({ id: schema.tags.id });
      await db.insert(schema.itemTags).values({ itemId: item.id, tagId: tag.id });
    }
    return item.id;
  }

  async function selectIds(
    condition: ReturnType<typeof createCollectionProcessingPolicy>['scope'],
  ) {
    const rows = await db
      .select({ platformItemId: schema.items.platformItemId })
      .from(schema.items)
      .where(condition)
      .orderBy(schema.items.platformItemId);
    return rows.map((row) => row.platformItemId);
  }

  it('combines optional platform scope with downstream eligibility', async () => {
    await seedItem('bilibili', 'bili-invalid', { platformMeta: { attr: 9 } });
    await seedItem('bilibili', 'bili-valid', { platformMeta: { attr: 0 } });
    await seedItem('test', 'unknown-platform');

    const bilibili = createCollectionProcessingPolicy(db, 'bilibili');
    const allPlatforms = createCollectionProcessingPolicy(db);

    await expect(selectIds(bilibili.content.total)).resolves.toEqual(['bili-valid']);
    await expect(selectIds(allPlatforms.content.total)).resolves.toEqual([
      'bili-valid',
      'unknown-platform',
    ]);
  });

  it('keeps Content totals and completion on the existing lifecycle states', async () => {
    await seedItem('bilibili', 'chunked', { contentState: 'chunked' });
    await seedItem('bilibili', 'embedded', { contentState: 'embedded' });
    await seedItem('bilibili', 'error', { contentState: 'error' });
    await seedItem('bilibili', 'has-content', { contentState: 'has_content' });
    await seedItem('bilibili', 'invalid', {
      contentState: 'chunked',
      platformMeta: { attr: 9 },
    });
    await seedItem('bilibili', 'no-content', { contentState: 'no_content' });
    await seedItem('bilibili', 'pending');

    const policy = createCollectionProcessingPolicy(db, 'bilibili');

    await expect(selectIds(policy.content.total)).resolves.toEqual([
      'chunked',
      'embedded',
      'error',
      'has-content',
      'no-content',
      'pending',
    ]);
    await expect(selectIds(policy.content.done)).resolves.toEqual([
      'chunked',
      'embedded',
      'error',
      'no-content',
    ]);
  });

  it('distinguishes Embedding coverage from executable candidates', async () => {
    await seedItem('bilibili', 'embedded', {
      chunkTexts: ['embedded'],
      contentState: 'embedded',
    });
    await seedItem('bilibili', 'error', { contentState: 'error' });
    await seedItem('bilibili', 'ghost', { contentState: 'chunked' });
    await seedItem('bilibili', 'invalid', {
      chunkTexts: ['invalid'],
      contentState: 'chunked',
      platformMeta: { attr: 9 },
    });
    await seedItem('bilibili', 'no-content', { contentState: 'no_content' });
    await seedItem('bilibili', 'valid', {
      chunkTexts: ['valid'],
      contentState: 'chunked',
    });

    const policy = createCollectionProcessingPolicy(db, 'bilibili');

    await expect(selectIds(policy.embedding.total)).resolves.toEqual([
      'embedded',
      'ghost',
      'valid',
    ]);
    await expect(selectIds(policy.embedding.done)).resolves.toEqual(['embedded']);
    await expect(selectIds(policy.embedding.pendingCandidate)).resolves.toEqual(['valid']);
  });

  it('derives Tags coverage and candidates without requiring chunks', async () => {
    await seedItem('bilibili', 'embedded-tagged', {
      contentState: 'embedded',
      tagged: true,
    });
    await seedItem('bilibili', 'error', { contentState: 'error' });
    await seedItem('bilibili', 'ghost', { contentState: 'chunked' });
    await seedItem('bilibili', 'invalid', {
      contentState: 'chunked',
      platformMeta: { attr: 9 },
    });
    await seedItem('bilibili', 'no-content', { contentState: 'no_content' });
    await seedItem('bilibili', 'valid', {
      chunkTexts: ['valid'],
      contentState: 'chunked',
    });

    const policy = createCollectionProcessingPolicy(db, 'bilibili');

    await expect(selectIds(policy.tagging.total)).resolves.toEqual([
      'embedded-tagged',
      'ghost',
      'valid',
    ]);
    await expect(selectIds(policy.tagging.done)).resolves.toEqual(['embedded-tagged']);
    await expect(selectIds(policy.tagging.pendingCandidate)).resolves.toEqual([
      'ghost',
      'valid',
    ]);
  });
});
