import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { syncFavVideosToDb } from './videos-sync';
import type { BiliFavVideo } from './types';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins). See ADR in
// .trellis/spec/frontend/database-bridge.md — re-sync must never update or
// delete rows in items / authors / item_sources.
// ---------------------------------------------------------------------------

function makeVideo(overrides: Partial<BiliFavVideo> & { bvid: string }): BiliFavVideo {
  return {
    id: 1,
    type: 2,
    title: 'Original Title',
    cover: 'https://example.com/cover.jpg',
    intro: 'original intro',
    duration: 120,
    upper: { mid: 100, name: 'Alice', face: 'https://example.com/alice.jpg' },
    cnt_info: { play: 1000, collect: 10, danmaku: 5 },
    fav_time: 1700000000,
    attr: 0,
    ...overrides,
  };
}

describe('syncFavVideosToDb insert-only invariant', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  const sourceA = 'folder-a';
  const sourceB = 'folder-b';
  let sourceAId: string;
  let sourceBId: string;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    const rows = await db
      .insert(schema.sources)
      .values([
        { platform: 'bilibili', platformSourceId: 'folder-a', title: 'Folder A' },
        { platform: 'bilibili', platformSourceId: 'folder-b', title: 'Folder B' },
      ])
      .returning();
    sourceAId = rows[0].id;
    sourceBId = rows[1].id;
  });

  afterAll(async () => {
    await pg.close();
  });

  async function getItem(bvid: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.platform, 'bilibili'), eq(schema.items.platformItemId, bvid)));
    return rows[0];
  }

  async function getAuthor(mid: number) {
    const rows = await db
      .select()
      .from(schema.authors)
      .where(
        and(
          eq(schema.authors.platform, 'bilibili'),
          eq(schema.authors.platformAuthorId, String(mid)),
        ),
      );
    return rows[0];
  }

  it('re-sync with changed metadata keeps first-write values', async () => {
    const original = makeVideo({
      bvid: 'BV1FIRST',
      upper: { mid: 100, name: 'Alice', face: 'https://example.com/alice.jpg' },
    });
    await syncFavVideosToDb(db, [original], sourceA);

    const mutated = makeVideo({
      bvid: 'BV1FIRST',
      title: '已失效视频',
      intro: 'mutated intro',
      cover: 'https://example.com/new-cover.jpg',
      attr: 9,
      upper: { mid: 100, name: 'Alice Renamed', face: 'https://example.com/new-face.jpg' },
      cnt_info: { play: 999999, collect: 1, danmaku: 0 },
    });
    const result = await syncFavVideosToDb(db, [mutated], sourceA);
    expect(result.synced).toBe(1);

    const item = await getItem('BV1FIRST');
    expect(item.title).toBe('Original Title');
    expect(item.authorName).toBe('Alice');
    const meta = item.platformMeta as Record<string, unknown>;
    expect(meta.intro).toBe('original intro');
    expect(meta.attr).toBe(0);
    expect(meta.cover).toBe('https://example.com/cover.jpg');

    const author = await getAuthor(100);
    expect(author.name).toBe('Alice');
    expect(author.avatarUrl).toBe('https://example.com/alice.jpg');
  });

  it('unfavorited video rows and links are retained on re-sync', async () => {
    const v1 = makeVideo({ bvid: 'BV2KEEP', upper: { mid: 200, name: 'Bob', face: '' } });
    const v2 = makeVideo({ bvid: 'BV2STAY', upper: { mid: 200, name: 'Bob', face: '' } });
    await syncFavVideosToDb(db, [v1, v2], sourceA);

    // v1 was unfavorited — re-sync returns only v2.
    await syncFavVideosToDb(db, [v2], sourceA);

    const removed = await getItem('BV2KEEP');
    expect(removed).toBeDefined();

    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, removed.id));
    expect(links).toHaveLength(1);
    expect(links[0].sourceId).toBe(sourceAId);
  });

  it('cross-folder move keeps both folder links', async () => {
    const v = makeVideo({ bvid: 'BV3MOVE', upper: { mid: 300, name: 'Carol', face: '' } });
    const first = await syncFavVideosToDb(db, [v], sourceA);
    const second = await syncFavVideosToDb(db, [v], sourceB);

    expect(first.newItemIds).toEqual(['BV3MOVE']);
    expect(second.newItemIds).toEqual([]);

    const item = await getItem('BV3MOVE');
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, item.id));
    const sourceIds = links.map((l) => l.sourceId).sort();
    expect(sourceIds).toEqual([sourceAId, sourceBId].sort());
  });

  it('re-sync does not reset contentState advanced by the transcription pipeline', async () => {
    const v = makeVideo({ bvid: 'BV4STATE', upper: { mid: 400, name: 'Dave', face: '' } });
    await syncFavVideosToDb(db, [v], sourceA);

    const item = await getItem('BV4STATE');
    expect(item.contentState).toBe('pending');

    // Transcription pipeline advances state — the one allowed update path.
    await db
      .update(schema.items)
      .set({ contentState: 'has_content' })
      .where(eq(schema.items.id, item.id));

    await syncFavVideosToDb(db, [v], sourceA);

    const after = await getItem('BV4STATE');
    expect(after.contentState).toBe('has_content');
  });
});
