import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { queryObsidianNotes } from './query';

describe('queryObsidianNotes', () => {
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

  async function seedItem(opts: {
    platformItemId: string;
    title: string;
    createdAt: Date;
    platform?: string;
    publishedAt?: Date | null;
  }) {
    const platform = opts.platform ?? 'bilibili';
    const [author] = await db
      .insert(schema.authors)
      .values({
        platform,
        platformAuthorId: `author-${opts.platformItemId}`,
        name: `UP-${opts.platformItemId}`,
      })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform,
        platformItemId: opts.platformItemId,
        authorId: author.id,
        title: opts.title,
        authorName: `UP-${opts.platformItemId}`,
        originalUrl: `https://example.com/${opts.platformItemId}`,
        publishedAt: opts.publishedAt ?? null,
        contentState: 'pending',
        createdAt: opts.createdAt,
      })
      .returning();
    return item;
  }

  async function linkSource(itemId: string, platformSourceId: string, title: string) {
    const [source] = await db
      .insert(schema.sources)
      .values({ platform: 'bilibili', platformSourceId, title })
      .returning();
    await db.insert(schema.itemSources).values({ itemId, sourceId: source.id });
  }

  async function linkTag(itemId: string, name: string) {
    const [tag] = await db.insert(schema.tags).values({ name }).returning();
    await db.insert(schema.itemTags).values({ itemId, tagId: tag.id });
  }

  it('returns an empty list for an empty database', async () => {
    expect(await queryObsidianNotes(db)).toEqual([]);
  });

  it('projects an item with content, tags and collections', async () => {
    const item = await seedItem({
      platformItemId: 'BV-FULL',
      title: 'Full item',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2025-03-14T08:00:00.000Z'),
    });
    await db
      .insert(schema.itemContents)
      .values({ itemId: item.id, plainText: 'transcript body' });
    await linkSource(item.id, 'fav-1', '编程学习');
    await linkTag(item.id, '前端');

    const notes = await queryObsidianNotes(db);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: item.id,
      platform: 'bilibili',
      title: 'Full item',
      authorName: 'UP-BV-FULL',
      originalUrl: 'https://example.com/BV-FULL',
      plainText: 'transcript body',
      sources: ['编程学习'],
      tags: ['前端'],
    });
    expect(notes[0].publishedAt).toEqual(new Date('2025-03-14T08:00:00.000Z'));
    expect(notes[0].savedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  // content_state pending/no_content/error have no item_contents row at all.
  it('yields a null body for an item without content instead of dropping it', async () => {
    await seedItem({
      platformItemId: 'BV-NOCONTENT',
      title: 'No content',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const notes = await queryObsidianNotes(db);
    const row = notes.find((n) => n.title === 'No content');
    expect(row).toBeDefined();
    expect(row!.plainText).toBeNull();
    expect(row!.sources).toEqual([]);
    expect(row!.tags).toEqual([]);
  });

  it('aggregates every collection an item belongs to, sorted', async () => {
    const item = await seedItem({
      platformItemId: 'Z-MULTI',
      title: 'Multi collection',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      platform: 'zhihu',
    });
    await linkSource(item.id, 'fav-tech', '技术收藏');
    await linkSource(item.id, 'fav-product', '产品思考');

    const notes = await queryObsidianNotes(db);
    const row = notes.find((n) => n.title === 'Multi collection');
    expect(row!.sources).toEqual(['产品思考', '技术收藏']);
  });

  it('aggregates tags sorted by name', async () => {
    const item = await seedItem({
      platformItemId: 'BV-TAGS',
      title: 'Many tags',
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });
    await linkTag(item.id, 'zebra');
    await linkTag(item.id, 'alpha');

    const notes = await queryObsidianNotes(db);
    const row = notes.find((n) => n.title === 'Many tags');
    expect(row!.tags).toEqual(['alpha', 'zebra']);
  });

  // Reproducible order is what makes filename dedupe suffixes stable across exports.
  it('orders rows by created_at then id', async () => {
    const notes = await queryObsidianNotes(db);
    const stamps = notes.map((n) => n.savedAt.toISOString());
    expect([...stamps]).toEqual([...stamps].sort());
  });
});
