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

// Service transitively imports `browser` from 'wxt/browser'; the DB path never
// calls it, so mock it away.
vi.mock('wxt/browser', () => ({ browser: {} }));

import {
  syncBookmarkTreeToDb,
  getBookmarks,
  getFolders,
  getLastSyncedAt,
  type BookmarkTree,
  type BookmarkEntry,
  type BookmarkFolder,
} from './bookmarks-sync-service';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins) for the bookmarks platform. Mirrors
// lib/github/github-sync-service.test.ts — see ADR in
// .trellis/spec/frontend/database-bridge.md. Re-sync must never update or
// delete rows in items / authors / item_sources. `sources` rows are the allowed
// upsert exception (title / path / lastFetchedAt freshness).
// ---------------------------------------------------------------------------

function folder(id: string, title: string, path?: string): BookmarkFolder {
  return { id, title, path: path ?? title };
}

function bm(
  url: string,
  folderId: string,
  opts: { title?: string; dateAdded?: number; normalizedUrl?: string } = {},
): BookmarkEntry {
  return {
    normalizedUrl: opts.normalizedUrl ?? url,
    url,
    title: opts.title ?? url,
    domain: new URL(url).hostname,
    dateAdded: opts.dateAdded ?? 1000,
    folderId,
  };
}

function tree(folders: BookmarkFolder[], bookmarks: BookmarkEntry[]): BookmarkTree {
  return { folders, bookmarks };
}

describe('bookmarks-sync-service (in-memory PGlite)', () => {
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
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.authors);
    await db.delete(schema.sources);
  });

  async function getItem(normalizedUrl: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(
        and(
          eq(schema.items.platform, 'bookmarks'),
          eq(schema.items.platformItemId, normalizedUrl),
        ),
      );
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // First sync
  // -------------------------------------------------------------------------

  it('persists folders→sources, domains→authors, bookmarks→items, links', async () => {
    const result = await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'Bookmarks Bar'), folder('11', 'Tech', 'Bookmarks Bar/Tech')],
        [
          bm('https://github.com/x', '1', { title: 'GH', dateAdded: 3000 }),
          bm('https://web.dev/', '11', { dateAdded: 2000 }),
        ],
      ),
    );
    expect(result).toEqual({ totalBookmarks: 2, syncedItems: 2, folders: 2 });

    const sourceRows = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.platform, 'bookmarks'));
    expect(sourceRows).toHaveLength(2);
    const bar = sourceRows.find((s) => s.platformSourceId === '1')!;
    expect(bar.title).toBe('Bookmarks Bar');
    expect(bar.lastFetchedAt).not.toBeNull();

    // authors = distinct domains
    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'bookmarks'));
    expect(authorRows.map((a) => a.platformAuthorId).sort()).toEqual(['github.com', 'web.dev']);

    // items mapping + platformMeta + no_content state + publishedAt from dateAdded
    const item = await getItem('https://github.com/x');
    expect(item.title).toBe('GH');
    expect(item.authorName).toBe('github.com');
    expect(item.originalUrl).toBe('https://github.com/x');
    expect(item.contentState).toBe('no_content');
    expect(item.publishedAt?.getTime()).toBe(3000);
    expect(item.platformMeta).toEqual({ domain: 'github.com', dateAdded: 3000 });

    // one link per bookmark
    const links = await db.select().from(schema.itemSources);
    expect(links).toHaveLength(2);
  });

  it('skips folders that have no direct bookmarks', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'Bar'), folder('9', 'Empty'), folder('8', 'OnlySubfolders')],
        [bm('https://a.com/', '1')],
      ),
    );
    const sourceRows = await db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.platform, 'bookmarks'));
    expect(sourceRows.map((s) => s.platformSourceId)).toEqual(['1']);
  });

  it('same URL in multiple folders → one item, one link per folder', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'A'), folder('2', 'B')],
        [bm('https://dup.com/x', '1'), bm('https://dup.com/x', '2')],
      ),
    );

    const itemRows = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.platform, 'bookmarks'));
    expect(itemRows).toHaveLength(1);

    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, itemRows[0].id));
    expect(links).toHaveLength(2);
  });

  it('empty tree writes nothing', async () => {
    const result = await syncBookmarkTreeToDb(db, tree([folder('1', 'Bar')], []));
    expect(result).toEqual({ totalBookmarks: 0, syncedItems: 0, folders: 0 });
    expect(await getLastSyncedAt(db)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Insert-only guard
  // -------------------------------------------------------------------------

  it('re-sync keeps first item values but refreshes the source row', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree([folder('1', 'Bar')], [bm('https://x.com/', '1', { title: 'Original' })]),
    );
    const before = (
      await db.select().from(schema.sources).where(eq(schema.sources.platformSourceId, '1'))
    )[0];

    await syncBookmarkTreeToDb(
      db,
      tree([folder('1', 'Bar Renamed')], [bm('https://x.com/', '1', { title: 'Changed' })]),
    );

    // item: first-write-wins
    const item = await getItem('https://x.com/');
    expect(item.title).toBe('Original');

    // source: upsert exception — title + lastFetchedAt refreshed, same row
    const after = (
      await db.select().from(schema.sources).where(eq(schema.sources.platformSourceId, '1'))
    )[0];
    expect(after.id).toBe(before.id);
    expect(after.title).toBe('Bar Renamed');
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('re-sync appends only new bookmarks without duplicating rows or links', async () => {
    await syncBookmarkTreeToDb(db, tree([folder('1', 'Bar')], [bm('https://a.com/', '1')]));
    await syncBookmarkTreeToDb(
      db,
      tree([folder('1', 'Bar')], [bm('https://a.com/', '1'), bm('https://b.com/', '1')]),
    );

    const itemRows = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.platform, 'bookmarks'));
    expect(itemRows).toHaveLength(2);

    const links = await db.select().from(schema.itemSources);
    expect(links).toHaveLength(2);
  });

  it('a removed bookmark is retained on re-sync', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree([folder('1', 'Bar')], [bm('https://keep.com/', '1'), bm('https://gone.com/', '1')]),
    );
    await syncBookmarkTreeToDb(db, tree([folder('1', 'Bar')], [bm('https://keep.com/', '1')]));

    expect(await getItem('https://gone.com/')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getBookmarks orders by dateAdded desc, paginates, and filters by folder', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'A'), folder('2', 'B')],
        [
          bm('https://one.com/', '1', { dateAdded: 100 }),
          bm('https://two.com/', '1', { dateAdded: 300 }),
          bm('https://three.com/', '2', { dateAdded: 200 }),
        ],
      ),
    );

    const all = await getBookmarks({ page: 1, pageSize: 10 }, db);
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.url)).toEqual([
      'https://two.com/',
      'https://three.com/',
      'https://one.com/',
    ]);

    const folderA = await getBookmarks({ folderId: '1', page: 1, pageSize: 10 }, db);
    expect(folderA.total).toBe(2);
    expect(folderA.rows.map((r) => r.url)).toEqual(['https://two.com/', 'https://one.com/']);

    const page2 = await getBookmarks({ page: 2, pageSize: 2 }, db);
    expect(page2.rows.map((r) => r.url)).toEqual(['https://one.com/']);
  });

  it('getBookmarks searches title and domain (ILIKE, metachars literal)', async () => {
    await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'A')],
        [
          bm('https://github.com/x', '1', { title: 'My Repo' }),
          bm('https://example.org/y', '1', { title: 'Docs' }),
        ],
      ),
    );

    expect((await getBookmarks({ search: 'repo', page: 1, pageSize: 10 }, db)).rows.map((r) => r.url)).toEqual([
      'https://github.com/x',
    ]);
    // domain match
    expect(
      (await getBookmarks({ search: 'example.org', page: 1, pageSize: 10 }, db)).rows.map((r) => r.url),
    ).toEqual(['https://example.org/y']);
    // LIKE wildcard is literal
    expect((await getBookmarks({ search: '%', page: 1, pageSize: 10 }, db)).total).toBe(0);
  });

  it('getFolders returns folders in first-seen order with paths; getLastSyncedAt tracks sync', async () => {
    expect(await getLastSyncedAt(db)).toBeNull();

    await syncBookmarkTreeToDb(
      db,
      tree(
        [folder('1', 'Bar'), folder('11', 'Tech', 'Bar/Tech')],
        [bm('https://a.com/', '1'), bm('https://b.com/', '11')],
      ),
    );

    const folders = await getFolders(db);
    expect(folders).toEqual([
      { folderId: '1', title: 'Bar', path: 'Bar' },
      { folderId: '11', title: 'Tech', path: 'Bar/Tech' },
    ]);
    expect(await getLastSyncedAt(db)).not.toBeNull();
  });
});
