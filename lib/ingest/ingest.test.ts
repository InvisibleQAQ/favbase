import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { ingestCollection, persistExistingItemContent } from './ingest';

describe('ingest module', () => {
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

  async function seedItem(platformItemId: string) {
    const [author] = await db
      .insert(schema.authors)
      .values({
        platform: 'bilibili',
        platformAuthorId: `author-${platformItemId}`,
        name: 'UP',
      })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform: 'bilibili',
        platformItemId,
        authorId: author.id,
        title: 'Video',
        authorName: 'UP',
        originalUrl: `https://www.bilibili.com/video/${platformItemId}`,
        contentState: 'pending',
      })
      .returning();
    return item;
  }

  it('replaces prepared content and timestamped chunks on re-transcription', async () => {
    const item = await seedItem('BV-CONTENT');

    const result = await persistExistingItemContent(
      db,
      'bilibili',
      'BV-CONTENT',
      '  first line\nsecond line  ',
      [
        { text: 'first line', startSec: 1.25, endSec: 2.5 },
        { text: 'second line', startSec: 3, endSec: 4.75 },
      ],
    );

    expect(result).toBe('chunked');
    await expect(
      db.select({ plainText: schema.itemContents.plainText }).from(schema.itemContents),
    ).resolves.toEqual([{ plainText: 'first line\nsecond line' }]);
    await expect(
      db
        .select({
          text: schema.itemChunks.chunkText,
          startSec: schema.itemChunks.startSec,
          endSec: schema.itemChunks.endSec,
        })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id))
        .orderBy(asc(schema.itemChunks.chunkIndex)),
    ).resolves.toEqual([
      { text: 'first line', startSec: 1.25, endSec: 2.5 },
      { text: 'second line', startSec: 3, endSec: 4.75 },
    ]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);

    await db
      .update(schema.items)
      .set({ contentState: 'embedded' })
      .where(eq(schema.items.id, item.id));
    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-CONTENT',
        'replacement line',
        [{ text: 'replacement line', startSec: 8, endSec: 9.5 }],
      ),
    ).resolves.toBe('chunked');
    await expect(
      db
        .select({ plainText: schema.itemContents.plainText })
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toEqual([{ plainText: 'replacement line' }]);
    await expect(
      db
        .select({
          text: schema.itemChunks.chunkText,
          startSec: schema.itemChunks.startSec,
          endSec: schema.itemChunks.endSec,
        })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id)),
    ).resolves.toEqual([{ text: 'replacement line', startSec: 8, endSec: 9.5 }]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);
  });

  it('rolls an advanced state back to has_content when chunk replacement fails', async () => {
    const item = await seedItem('BV-CHUNK-FAIL');
    await db
      .update(schema.items)
      .set({ contentState: 'embedded' })
      .where(eq(schema.items.id, item.id));

    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-CHUNK-FAIL',
        'replacement that could not be chunked',
        [{ text: null as unknown as string, startSec: 0, endSec: 1 }],
      ),
    ).rejects.toThrow();

    await expect(
      db
        .select({ plainText: schema.itemContents.plainText })
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toEqual([{ plainText: 'replacement that could not be chunked' }]);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'has_content' }]);
  });

  it('does not persist non-empty text without prepared chunks', async () => {
    const item = await seedItem('BV-NO-CHUNKS');

    const result = await persistExistingItemContent(
      db,
      'bilibili',
      'BV-NO-CHUNKS',
      'text without chunks',
      [],
    );

    expect(result).toBeNull();
    await expect(
      db
        .select()
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'pending' }]);
  });

  it('returns null without writes when the platform item is missing', async () => {
    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-MISSING',
        'missing item content',
        [{ text: 'missing item content', startSec: 0, endSec: 1 }],
      ),
    ).resolves.toBeNull();
  });

  it('leaves existing state and content untouched for blank text', async () => {
    const item = await seedItem('BV-BLANK');

    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-BLANK',
        '  \n  ',
        [{ text: 'should not be written', startSec: 0, endSec: 1 }],
      ),
    ).resolves.toBeNull();
    await expect(
      db
        .select()
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'pending' }]);
  });

  it('upserts sources when collection ingest has no items', async () => {
    const baseInput = {
      platform: 'bilibili',
      authors: [],
      items: [],
      links: [],
    };

    await ingestCollection(db, {
      ...baseInput,
      sources: [
        { platformSourceId: 'folder-source-only', title: 'Old title', platformMeta: { count: 1 } },
      ],
    });
    await ingestCollection(db, {
      ...baseInput,
      sources: [
        { platformSourceId: 'folder-source-only', title: 'New title', platformMeta: { count: 2 } },
      ],
    });

    await expect(
      db
        .select({ title: schema.sources.title, meta: schema.sources.platformMeta })
        .from(schema.sources)
        .where(eq(schema.sources.platformSourceId, 'folder-source-only')),
    ).resolves.toEqual([{ title: 'New title', meta: { count: 2 } }]);
  });
});
