import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';

// No storage mock: the service's load graph is storage-free by contract
// (tests/lib-import-smoke.test.ts). The DB path never embeds inline (D3).
import {
  syncBookmarksToDb,
  getBookmarks,
  getAuthorCounts,
  getLastSyncedAt,
} from './x-sync-service';
import type { XRawBookmark } from './x-api';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins) for the `x` platform. Mirrors
// lib/github/github-sync-service.test.ts — see ADR in
// .trellis/spec/frontend/database-bridge.md. Re-sync must never update or delete
// rows in items / authors / item_sources. The single `sources` row is the
// allowed upsert exception (lastFetchedAt freshness).
// ---------------------------------------------------------------------------

function makeTweet(overrides: Partial<XRawBookmark> & { id: string }): XRawBookmark {
  const author = {
    handle: 'alice',
    name: 'Alice',
    avatarUrl: 'https://pbs.twimg.com/alice.jpg',
    restId: 'u_alice',
    ...overrides.author,
  };
  return {
    text: `tweet ${overrides.id} full text`,
    createdAt: 'Wed Jan 01 00:00:00 +0000 2025',
    media: [],
    likeCount: 5,
    retweetCount: 2,
    replyCount: 1,
    lang: 'en',
    url: `https://x.com/${author.handle}/status/${overrides.id}`,
    ...overrides,
    author,
  };
}

describe('x-sync-service (in-memory PGlite)', () => {
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

  async function getItem(tweetId: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.platform, 'x'), eq(schema.items.platformItemId, tweetId)));
    return rows[0];
  }

  async function getBookmarksSource() {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.platform, 'x'), eq(schema.sources.platformSourceId, 'bookmarks')));
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // First sync
  // -------------------------------------------------------------------------

  it('first sync persists source / authors / items / links + content + chunks', async () => {
    const bookmarks = [
      makeTweet({ id: '1' }),
      makeTweet({ id: '2' }),
      makeTweet({
        id: '3',
        author: { handle: 'bob', name: 'Bob', avatarUrl: 'https://pbs.twimg.com/bob.jpg', restId: 'u_bob' },
      }),
    ];

    const result = await syncBookmarksToDb(db, bookmarks);
    expect(result).toMatchObject({ total: 3, synced: 3, inserted: 3 });
    // Auto-tagging input: every tweet carries text, so all new items qualify.
    expect(result.newItemIds).toEqual(['1', '2', '3']);

    // sources: single "bookmarks" row
    const source = await getBookmarksSource();
    expect(source.title).toBe('X Bookmarks');
    expect(source.lastFetchedAt).not.toBeNull();

    // authors: alice appears twice → one row; bob → one row
    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'x'));
    expect(authorRows).toHaveLength(2);

    // items: field mapping + platformMeta shape + content_state='chunked'
    const item = await getItem('1');
    expect(item.title).toBe('tweet 1 full text');
    expect(item.authorName).toBe('Alice');
    expect(item.originalUrl).toBe('https://x.com/alice/status/1');
    expect(item.contentState).toBe('chunked');
    expect(item.platformMeta).toMatchObject({
      text: 'tweet 1 full text',
      authorHandle: 'alice',
      authorName: 'Alice',
      likeCount: 5,
      retweetCount: 2,
      replyCount: 1,
      lang: 'en',
      media: [],
    });

    // item_sources: one link per tweet
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.sourceId, source.id));
    expect(links).toHaveLength(3);

    // item_contents + item_chunks written for each new item
    const contents = await db.select().from(schema.itemContents);
    expect(contents).toHaveLength(3);
    expect(contents.find((c) => c.itemId === item.id)?.plainText).toBe('tweet 1 full text');

    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, item.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toBe('tweet 1 full text');
    // Embedding NOT run inline (deferred to 「重建向量」)
    expect(chunks[0].embedding).toBeNull();
  });

  it('empty bookmark list still upserts the sources row (synced-but-empty state)', async () => {
    expect(await getLastSyncedAt(db)).toBeNull();

    const result = await syncBookmarksToDb(db, []);
    expect(result).toMatchObject({ total: 0, synced: 0, inserted: 0 });

    expect(await getLastSyncedAt(db)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Insert-only guard
  // -------------------------------------------------------------------------

  it('re-sync with changed metadata keeps first-write values (insert-only)', async () => {
    await syncBookmarksToDb(db, [makeTweet({ id: '10' })]);
    const before = await getBookmarksSource();

    const mutated = makeTweet({
      id: '10',
      text: 'MUTATED text',
      likeCount: 99999,
      author: { handle: 'alice', name: 'Alice Renamed', avatarUrl: 'https://x/new.jpg', restId: 'u_alice' },
    });
    const result = await syncBookmarksToDb(db, [mutated]);
    // Already known → incremental would skip in production; direct DB path
    // still inserts nothing new.
    expect(result.inserted).toBe(0);
    // Nothing newly persisted → auto-tagging gets an empty batch on re-sync.
    expect(result.newItemIds).toEqual([]);

    const item = await getItem('10');
    expect(item.title).toBe('tweet 10 full text');
    const meta = item.platformMeta as Record<string, unknown>;
    expect(meta.text).toBe('tweet 10 full text');
    expect(meta.likeCount).toBe(5);

    const author = await db
      .select()
      .from(schema.authors)
      .where(and(eq(schema.authors.platform, 'x'), eq(schema.authors.platformAuthorId, 'u_alice')));
    expect(author[0].name).toBe('Alice');

    // sources upsert exception: lastFetchedAt refreshed
    const after = await getBookmarksSource();
    expect(after.id).toBe(before.id);
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('re-sync appends only new tweets without duplicating rows / links / content', async () => {
    await syncBookmarksToDb(db, [makeTweet({ id: '20' })]);
    await syncBookmarksToDb(db, [makeTweet({ id: '20' }), makeTweet({ id: '21' })]);

    const itemRows = await db.select().from(schema.items).where(eq(schema.items.platform, 'x'));
    expect(itemRows).toHaveLength(2);

    const item20 = await getItem('20');
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, item20.id));
    expect(links).toHaveLength(1);

    // content not re-written for the already-existing item (only new ones)
    const contents = await db.select().from(schema.itemContents);
    expect(contents).toHaveLength(2);
  });

  it('un-bookmarked tweet rows and links are retained on re-sync', async () => {
    await syncBookmarksToDb(db, [makeTweet({ id: '30' }), makeTweet({ id: '31' })]);
    await syncBookmarksToDb(db, [makeTweet({ id: '31' })]);

    const kept = await getItem('30');
    expect(kept).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getBookmarks orders by publishedAt desc and paginates', async () => {
    await syncBookmarksToDb(db, [
      makeTweet({ id: '40', createdAt: 'Wed Jan 01 00:00:00 +0000 2024' }),
      makeTweet({ id: '41', createdAt: 'Fri Mar 01 00:00:00 +0000 2024' }),
      makeTweet({ id: '42', createdAt: 'Thu Feb 01 00:00:00 +0000 2024' }),
    ]);

    const page1 = await getBookmarks({ page: 1, pageSize: 2 }, db);
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.tweetId)).toEqual(['41', '42']);
    expect(page1.rows[0]).toMatchObject({
      authorName: 'Alice',
      authorHandle: 'alice',
      originalUrl: 'https://x.com/alice/status/41',
    });

    const page2 = await getBookmarks({ page: 2, pageSize: 2 }, db);
    expect(page2.rows.map((r) => r.tweetId)).toEqual(['40']);
  });

  it('getBookmarks filters by author handle and searches text/author', async () => {
    await syncBookmarksToDb(db, [
      makeTweet({ id: '50', text: 'hello typescript world' }),
      makeTweet({
        id: '51',
        text: 'a fast rust cli',
        author: { handle: 'bob', name: 'Bob', avatarUrl: '', restId: 'u_bob' },
      }),
    ]);

    const byAuthor = await getBookmarks({ author: 'bob', page: 1, pageSize: 10 }, db);
    expect(byAuthor.total).toBe(1);
    expect(byAuthor.rows[0].tweetId).toBe('51');

    const byText = await getBookmarks({ search: 'TYPESCRIPT', page: 1, pageSize: 10 }, db);
    expect(byText.rows.map((r) => r.tweetId)).toEqual(['50']);

    const byName = await getBookmarks({ search: 'bob', page: 1, pageSize: 10 }, db);
    expect(byName.rows.map((r) => r.tweetId)).toEqual(['51']);

    // LIKE metacharacters are literal, not wildcards
    const byWildcard = await getBookmarks({ search: '%', page: 1, pageSize: 10 }, db);
    expect(byWildcard.total).toBe(0);
  });

  it('getAuthorCounts groups by author desc', async () => {
    await syncBookmarksToDb(db, [
      makeTweet({ id: '60' }),
      makeTweet({ id: '61' }),
      makeTweet({
        id: '62',
        author: { handle: 'bob', name: 'Bob', avatarUrl: '', restId: 'u_bob' },
      }),
    ]);

    const counts = await getAuthorCounts(db);
    expect(counts).toEqual([
      { authorName: 'Alice', authorHandle: 'alice', count: 2 },
      { authorName: 'Bob', authorHandle: 'bob', count: 1 },
    ]);
  });
});
