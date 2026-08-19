import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import {
  COLLECTION_PLATFORMS,
  getCollectionItems,
  type CollectionPlatform,
} from './collections-query';
import { PLATFORM_SORT_KEYS } from './platform-sort-keys';

interface SeedItem {
  platform: CollectionPlatform;
  platformItemId: string;
  title?: string;
  authorName?: string;
  publishedAt?: Date | null;
  platformMeta?: Record<string, unknown>;
  createdAt?: Date;
}

function nativeSortInput(platform: CollectionPlatform, date: Date): Pick<SeedItem, 'publishedAt' | 'platformMeta'> {
  const sortKey = PLATFORM_SORT_KEYS[platform];
  if (sortKey.source === 'publishedAt') return { publishedAt: date };

  return {
    platformMeta: {
      [sortKey.field]: sortKey.format === 'unixSeconds' ? date.getTime() / 1000 : date.toISOString(),
    },
  };
}

describe('getCollectionItems (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let authorSeq = 0;

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

  async function seedItem(input: SeedItem): Promise<string> {
    const authorName = input.authorName ?? `Author ${input.platformItemId}`;
    const authorRows = await db
      .insert(schema.authors)
      .values({
        platform: input.platform,
        platformAuthorId: `author-${++authorSeq}`,
        name: authorName,
      })
      .returning({ id: schema.authors.id });

    const itemRows = await db
      .insert(schema.items)
      .values({
        platform: input.platform,
        platformItemId: input.platformItemId,
        authorId: authorRows[0].id,
        title: input.title ?? `Title ${input.platformItemId}`,
        authorName,
        originalUrl: `https://example.test/${input.platform}/${input.platformItemId}`,
        publishedAt: input.publishedAt ?? null,
        platformMeta: input.platformMeta ?? {},
        contentState: 'no_content',
        createdAt: input.createdAt ?? new Date('2025-01-01T00:00:00Z'),
      })
      .returning({ id: schema.items.id });

    return itemRows[0].id;
  }

  it('globally orders all platform rows by their native recency key', async () => {
    await seedItem({
      platform: 'bilibili',
      platformItemId: 'bili',
      platformMeta: { fav_time: Date.parse('2026-01-06T00:00:00Z') / 1000 },
    });
    await seedItem({
      platform: 'github',
      platformItemId: 'github',
      platformMeta: { starredAt: '2026-01-05T00:00:00Z' },
    });
    await seedItem({
      platform: 'bookmarks',
      platformItemId: 'bookmark',
      publishedAt: new Date('2026-01-04T00:00:00Z'),
    });
    await seedItem({
      platform: 'x',
      platformItemId: 'tweet',
      publishedAt: new Date('2026-01-03T00:00:00Z'),
    });
    await seedItem({
      platform: 'zhihu',
      platformItemId: 'zhihu',
      publishedAt: new Date('2026-01-02T00:00:00Z'),
    });
    await seedItem({
      platform: 'youtube',
      platformItemId: 'youtube',
      platformMeta: { addedAt: '2026-01-01T00:00:00Z' },
    });
    await seedItem({
      platform: 'bilibili',
      platformItemId: 'missing-date',
      createdAt: new Date('2027-01-01T00:00:00Z'),
    });

    const result = await getCollectionItems({ page: 1, pageSize: 20 }, db);

    expect(result.total).toBe(7);
    expect(result.rows.map((row) => row.platformItemId)).toEqual([
      'bili',
      'github',
      'bookmark',
      'tweet',
      'zhihu',
      'youtube',
      'missing-date',
    ]);
  });

  it('keeps every registered platform native-dated rows ahead of missing dates', async () => {
    for (const platform of COLLECTION_PLATFORMS) {
      const newest = new Date('2026-02-01T00:00:00Z');
      const older = new Date('2026-01-01T00:00:00Z');
      await seedItem({
        platform,
        platformItemId: `${platform}-newest`,
        ...nativeSortInput(platform, newest),
      });
      await seedItem({
        platform,
        platformItemId: `${platform}-older`,
        ...nativeSortInput(platform, older),
      });
      await seedItem({
        platform,
        platformItemId: `${platform}-missing`,
        createdAt: new Date('2027-01-01T00:00:00Z'),
      });

      const result = await getCollectionItems({ platform, page: 1, pageSize: 20 }, db);

      expect(result.rows.map((row) => row.platformItemId)).toEqual([
        `${platform}-newest`,
        `${platform}-older`,
        `${platform}-missing`,
      ]);
    }
  });

  it('filters by platform, escapes literal search wildcards, and paginates globally', async () => {
    await seedItem({
      platform: 'github',
      platformItemId: 'first',
      title: '100% useful',
      platformMeta: { starredAt: '2026-03-01T00:00:00Z' },
    });
    await seedItem({
      platform: 'github',
      platformItemId: 'second',
      title: 'ordinary repository',
      authorName: '100% maintainer',
      platformMeta: { starredAt: '2026-02-01T00:00:00Z' },
    });
    await seedItem({
      platform: 'github',
      platformItemId: 'wildcard-trap',
      title: 'unrelated',
      platformMeta: { starredAt: '2026-01-01T00:00:00Z' },
    });
    await seedItem({
      platform: 'x',
      platformItemId: 'other-platform',
      title: '100% useful',
      publishedAt: new Date('2026-04-01T00:00:00Z'),
    });

    const firstPage = await getCollectionItems(
      { platform: 'github', search: '100%', page: 1, pageSize: 1 },
      db,
    );
    const secondPage = await getCollectionItems(
      { platform: 'github', search: '100%', page: 2, pageSize: 1 },
      db,
    );

    expect(firstPage.total).toBe(2);
    expect(firstPage.rows.map((row) => row.platformItemId)).toEqual(['first']);
    expect(secondPage.rows.map((row) => row.platformItemId)).toEqual(['second']);
  });

  it('hydrates every tag for the current page in name order', async () => {
    const itemId = await seedItem({
      platform: 'x',
      platformItemId: 'tagged',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const tagRows = await db
      .insert(schema.tags)
      .values([{ name: 'beta' }, { name: 'alpha' }])
      .returning({ id: schema.tags.id, name: schema.tags.name });
    await db.insert(schema.itemTags).values(
      tagRows.map((tag) => ({ itemId, tagId: tag.id })),
    );

    const result = await getCollectionItems({ page: 1, pageSize: 20 }, db);

    expect(result.rows[0]).toMatchObject({
      platform: 'x',
      platformItemId: 'tagged',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.rows[0].tags.map((tag) => tag.name)).toEqual(['alpha', 'beta']);
  });

  it('filters by one tag before total, ordering, and pagination', async () => {
    const newest = await seedItem({
      platform: 'github',
      platformItemId: 'newest-match',
      platformMeta: { starredAt: '2026-03-01T00:00:00Z' },
    });
    await seedItem({
      platform: 'github',
      platformItemId: 'newest-unmatched',
      platformMeta: { starredAt: '2026-04-01T00:00:00Z' },
    });
    const older = await seedItem({
      platform: 'x',
      platformItemId: 'older-match',
      publishedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const [tag] = await db
      .insert(schema.tags)
      .values({ name: 'focused' })
      .returning({ id: schema.tags.id });
    await db.insert(schema.itemTags).values([
      { itemId: newest, tagId: tag.id },
      { itemId: older, tagId: tag.id },
    ]);

    const first = await getCollectionItems({ tagId: tag.id, page: 1, pageSize: 1 }, db);
    const second = await getCollectionItems({ tagId: tag.id, page: 2, pageSize: 1 }, db);

    expect(first.total).toBe(2);
    expect(first.rows.map((row) => row.platformItemId)).toEqual(['newest-match']);
    expect(second.rows.map((row) => row.platformItemId)).toEqual(['older-match']);
  });
});
