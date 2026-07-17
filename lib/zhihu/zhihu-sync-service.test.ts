import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';

// The service transitively reaches `@/lib/storage` at load time in some import
// graphs (chrome.runtime is absent under vitest) — mock it away, mirroring
// lib/x/x-sync-service.test.ts. The DB path never embeds inline (D3).
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn().mockResolvedValue({}) },
}));

import {
  syncFavoritesToDb,
  getFavorites,
  getCollectionCounts,
  getLastSyncedAt,
} from './zhihu-sync-service';
import type { ZhihuCollection, ZhihuRawFavorite } from './zhihu-api';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins) for the `zhihu` platform. Mirrors
// lib/x/x-sync-service.test.ts — see ADR in
// .trellis/spec/frontend/database-bridge.md. Re-sync must never update or
// delete rows in items / authors / item_sources. `sources` rows are the
// allowed upsert exception (title + lastFetchedAt freshness).
// ---------------------------------------------------------------------------

function makeCollection(id: string, title = `Collection ${id}`): ZhihuCollection {
  return { id, title };
}

function makeFavorite(
  overrides: Partial<ZhihuRawFavorite> & { id: string },
): ZhihuRawFavorite {
  const author = {
    id: 'a_alice',
    name: 'Alice',
    avatarUrl: 'https://pic1.zhimg.com/alice.jpg',
    ...overrides.author,
  };
  return {
    type: 'answer',
    title: `answer ${overrides.id}`,
    url: `https://www.zhihu.com/question/1/answer/${overrides.id}`,
    contentHtml: `<p>answer ${overrides.id} <b>body</b></p>`,
    excerpt: `answer ${overrides.id} body`,
    createdAt: 1700000000,
    thumbnailUrl: null,
    collectionId: 'c1',
    collectionTitle: 'Collection c1',
    ...overrides,
    author,
  };
}

describe('zhihu-sync-service (in-memory PGlite)', () => {
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

  // FK-safe cleanup order — no state leaks across tests.
  afterEach(async () => {
    await db.delete(schema.itemChunks);
    await db.delete(schema.itemContents);
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.authors);
    await db.delete(schema.sources);
  });

  async function getItem(platformItemId: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.platform, 'zhihu'), eq(schema.items.platformItemId, platformItemId)),
      );
    return rows[0];
  }

  async function getSource(collectionId: string) {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.platform, 'zhihu'),
          eq(schema.sources.platformSourceId, collectionId),
        ),
      );
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // First sync
  // -------------------------------------------------------------------------

  it('first sync persists sources / authors / items / links + markdown content + chunks', async () => {
    const collections = [makeCollection('c1'), makeCollection('c2')];
    const favorites = [
      makeFavorite({ id: '1' }),
      makeFavorite({
        id: '2',
        type: 'zvideo',
        title: 'a video',
        url: 'https://www.zhihu.com/zvideo/2',
        contentHtml: null,
        thumbnailUrl: 'https://pic4.zhimg.com/cover.jpg',
      }),
      makeFavorite({
        id: '3',
        type: 'article',
        title: 'an article',
        url: 'https://zhuanlan.zhihu.com/p/3',
        collectionId: 'c2',
        collectionTitle: 'Collection c2',
        author: { id: 'a_bob', name: 'Bob', avatarUrl: '' },
      }),
    ];

    const result = await syncFavoritesToDb(db, collections, favorites);
    expect(result).toMatchObject({ total: 3, synced: 3, inserted: 3, collections: 2 });

    // sources: one row per collection, lastFetchedAt stamped
    const c1 = await getSource('c1');
    const c2 = await getSource('c2');
    expect(c1.title).toBe('Collection c1');
    expect(c1.lastFetchedAt).not.toBeNull();
    expect(c2.lastFetchedAt).not.toBeNull();

    // authors: alice ×2 → one row; bob → one row
    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'zhihu'));
    expect(authorRows).toHaveLength(2);

    // items: field mapping + platformMeta shape + content_state per type
    const answer = await getItem('answer:1');
    expect(answer.title).toBe('answer 1');
    expect(answer.authorName).toBe('Alice');
    expect(answer.originalUrl).toBe('https://www.zhihu.com/question/1/answer/1');
    expect(answer.contentState).toBe('chunked');
    expect(answer.publishedAt).toEqual(new Date(1700000000 * 1000));
    expect(answer.platformMeta).toMatchObject({
      type: 'answer',
      excerpt: 'answer 1 body',
      authorName: 'Alice',
      avatarUrl: 'https://pic1.zhimg.com/alice.jpg',
      thumbnailUrl: null,
      collectionId: 'c1',
      collectionTitle: 'Collection c1',
    });

    // zvideo carries no body → no_content (never 'pending')
    const video = await getItem('zvideo:2');
    expect(video.contentState).toBe('no_content');
    expect(video.platformMeta).toMatchObject({
      type: 'zvideo',
      thumbnailUrl: 'https://pic4.zhimg.com/cover.jpg',
    });

    // item_sources: one link per membership
    const links = await db.select().from(schema.itemSources);
    expect(links).toHaveLength(3);

    // item_contents: markdown (turndown) written for the two text items only
    const contents = await db.select().from(schema.itemContents);
    expect(contents).toHaveLength(2);
    expect(contents.find((c) => c.itemId === answer.id)?.plainText).toBe('answer 1 **body**');

    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, answer.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toBe('answer 1 **body**');
    // Embedding NOT run inline (deferred to 「重建向量」)
    expect(chunks[0].embedding).toBeNull();
    expect(chunks[0].startSec).toBeNull();
    expect(chunks[0].endSec).toBeNull();
  });

  it('empty favorites still upsert collection sources (synced-but-empty state)', async () => {
    expect(await getLastSyncedAt(db)).toBeNull();

    const result = await syncFavoritesToDb(db, [makeCollection('c1')], []);
    expect(result).toMatchObject({ total: 0, synced: 0, inserted: 0, collections: 1 });

    expect(await getLastSyncedAt(db)).not.toBeNull();
  });

  it('zero collections persists nothing (lastSyncedAt stays null)', async () => {
    const result = await syncFavoritesToDb(db, [], []);
    expect(result).toMatchObject({ total: 0, synced: 0, inserted: 0, collections: 0 });
    expect(await getLastSyncedAt(db)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Insert-only guard
  // -------------------------------------------------------------------------

  it('re-sync with changed metadata keeps first-write values (insert-only)', async () => {
    const collections = [makeCollection('c1')];
    await syncFavoritesToDb(db, collections, [makeFavorite({ id: '10' })]);
    const before = await getSource('c1');

    const mutated = makeFavorite({
      id: '10',
      title: 'MUTATED title',
      contentHtml: '<p>MUTATED body</p>',
      excerpt: 'MUTATED',
      author: { id: 'a_alice', name: 'Alice Renamed', avatarUrl: 'https://x/new.jpg' },
    });
    const result = await syncFavoritesToDb(
      db,
      [makeCollection('c1', 'Renamed Collection')],
      [mutated],
    );
    expect(result.inserted).toBe(0);

    const item = await getItem('answer:10');
    expect(item.title).toBe('answer 10');
    const meta = item.platformMeta as Record<string, unknown>;
    expect(meta.excerpt).toBe('answer 10 body');

    const author = await db
      .select()
      .from(schema.authors)
      .where(
        and(eq(schema.authors.platform, 'zhihu'), eq(schema.authors.platformAuthorId, 'a_alice')),
      );
    expect(author[0].name).toBe('Alice');

    // content not re-written for the already-existing item
    const contents = await db.select().from(schema.itemContents);
    expect(contents.find((c) => c.itemId === item.id)?.plainText).toBe('answer 10 **body**');

    // sources upsert exception: title rename + lastFetchedAt refresh flow through
    const after = await getSource('c1');
    expect(after.id).toBe(before.id);
    expect(after.title).toBe('Renamed Collection');
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('re-sync appends only new items without duplicating rows / links / content', async () => {
    const collections = [makeCollection('c1')];
    await syncFavoritesToDb(db, collections, [makeFavorite({ id: '20' })]);
    await syncFavoritesToDb(db, collections, [makeFavorite({ id: '20' }), makeFavorite({ id: '21' })]);

    const itemRows = await db.select().from(schema.items).where(eq(schema.items.platform, 'zhihu'));
    expect(itemRows).toHaveLength(2);

    const item20 = await getItem('answer:20');
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, item20.id));
    expect(links).toHaveLength(1);

    const contents = await db.select().from(schema.itemContents);
    expect(contents).toHaveLength(2);
  });

  it('un-favorited item rows and links are retained on re-sync', async () => {
    const collections = [makeCollection('c1')];
    await syncFavoritesToDb(db, collections, [makeFavorite({ id: '30' }), makeFavorite({ id: '31' })]);
    await syncFavoritesToDb(db, collections, [makeFavorite({ id: '31' })]);

    const kept = await getItem('answer:30');
    expect(kept).toBeDefined();
  });

  it('an item favorited into two collections yields ONE item and two links', async () => {
    const collections = [makeCollection('c1'), makeCollection('c2')];
    await syncFavoritesToDb(db, collections, [
      makeFavorite({ id: '40' }),
      makeFavorite({ id: '40', collectionId: 'c2', collectionTitle: 'Collection c2' }),
    ]);

    const itemRows = await db.select().from(schema.items).where(eq(schema.items.platform, 'zhihu'));
    expect(itemRows).toHaveLength(1);

    const links = await db.select().from(schema.itemSources);
    expect(links).toHaveLength(2);

    // Collection chip filter resolves via item_sources, not platformMeta
    const inC2 = await getFavorites({ collectionId: 'c2', page: 1, pageSize: 10 }, db);
    expect(inC2.total).toBe(1);
    const inOther = await getFavorites({ collectionId: 'nope', page: 1, pageSize: 10 }, db);
    expect(inOther.total).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getFavorites orders by publishedAt desc and paginates', async () => {
    const collections = [makeCollection('c1')];
    await syncFavoritesToDb(db, collections, [
      makeFavorite({ id: '50', createdAt: 1600000000 }),
      makeFavorite({ id: '51', createdAt: 1700000000 }),
      makeFavorite({ id: '52', createdAt: 1650000000 }),
    ]);

    const page1 = await getFavorites({ page: 1, pageSize: 2 }, db);
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.platformItemId)).toEqual(['answer:51', 'answer:52']);
    expect(page1.rows[0]).toMatchObject({
      type: 'answer',
      authorName: 'Alice',
      originalUrl: 'https://www.zhihu.com/question/1/answer/51',
      collectionTitle: 'Collection c1',
    });

    const page2 = await getFavorites({ page: 2, pageSize: 2 }, db);
    expect(page2.rows.map((r) => r.platformItemId)).toEqual(['answer:50']);
  });

  it('getFavorites searches title / excerpt / author name with literal LIKE metachars', async () => {
    const collections = [makeCollection('c1')];
    await syncFavoritesToDb(db, collections, [
      makeFavorite({ id: '60', title: 'hello typescript world', excerpt: 'plain words' }),
      makeFavorite({
        id: '61',
        title: 'another one',
        excerpt: 'a fast rust cli',
        author: { id: 'a_bob', name: 'Bob', avatarUrl: '' },
      }),
    ]);

    const byTitle = await getFavorites({ search: 'TYPESCRIPT', page: 1, pageSize: 10 }, db);
    expect(byTitle.rows.map((r) => r.platformItemId)).toEqual(['answer:60']);

    const byExcerpt = await getFavorites({ search: 'rust cli', page: 1, pageSize: 10 }, db);
    expect(byExcerpt.rows.map((r) => r.platformItemId)).toEqual(['answer:61']);

    const byAuthor = await getFavorites({ search: 'bob', page: 1, pageSize: 10 }, db);
    expect(byAuthor.rows.map((r) => r.platformItemId)).toEqual(['answer:61']);

    // LIKE metacharacters are literal, not wildcards
    const byWildcard = await getFavorites({ search: '%', page: 1, pageSize: 10 }, db);
    expect(byWildcard.total).toBe(0);
  });

  it('getCollectionCounts groups by collection desc and skips empty collections', async () => {
    const collections = [makeCollection('c1'), makeCollection('c2'), makeCollection('c-empty')];
    await syncFavoritesToDb(db, collections, [
      makeFavorite({ id: '70' }),
      makeFavorite({ id: '71' }),
      makeFavorite({ id: '72', collectionId: 'c2', collectionTitle: 'Collection c2' }),
    ]);

    const counts = await getCollectionCounts(db);
    expect(counts).toEqual([
      { collectionId: 'c1', title: 'Collection c1', count: 2 },
      { collectionId: 'c2', title: 'Collection c2', count: 1 },
    ]);
  });
});
