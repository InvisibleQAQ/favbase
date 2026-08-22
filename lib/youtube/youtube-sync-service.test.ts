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
// (tests/lib-import-smoke.test.ts).
import {
  syncPlaylistsToDb,
  getPlaylistVideos,
  getPlaylistCounts,
  getLastSyncedAt,
  type PlaylistBatch,
} from './youtube-sync-service';
import type { YoutubePlaylist, YoutubePlaylistVideo, PlaylistEntry } from './youtube-api';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins) for the `youtube` platform. Mirrors
// lib/zhihu/zhihu-sync-service.test.ts — see ADR in
// .trellis/spec/frontend/database-bridge.md. Re-sync must never update or
// delete rows in items / authors / item_sources. The per-playlist `sources`
// rows are the allowed upsert exception (title + lastFetchedAt freshness).
// ---------------------------------------------------------------------------

function makePlaylist(playlistId: string, title?: string): YoutubePlaylist {
  return { playlistId, title: title ?? `Playlist ${playlistId}`, itemCount: 0 };
}

function makeVideo(
  overrides: Partial<YoutubePlaylistVideo> & { videoId: string },
): YoutubePlaylistVideo {
  return {
    title: `Video ${overrides.videoId}`,
    description: `original description of ${overrides.videoId}`,
    channelId: 'ch_alice',
    channelTitle: 'Alice Channel',
    thumbnailUrl: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
    durationSeconds: 300,
    viewCount: 1000,
    likeCount: 50,
    addedAt: '2026-01-01T00:00:00Z',
    videoPublishedAt: '2025-06-01T00:00:00Z',
    ...overrides,
  };
}

function toEntry(v: YoutubePlaylistVideo): PlaylistEntry {
  return { videoId: v.videoId, addedAt: v.addedAt, videoPublishedAt: v.videoPublishedAt };
}

/** Batch where every entry also has details (all videos are new this run). */
function makeBatch(
  playlist: YoutubePlaylist,
  videos: YoutubePlaylistVideo[],
  extraEntries: PlaylistEntry[] = [],
): PlaylistBatch {
  return { playlist, entries: [...videos.map(toEntry), ...extraEntries], videos };
}

describe('youtube-sync-service (in-memory PGlite)', () => {
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

  async function getItem(videoId: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.platform, 'youtube'), eq(schema.items.platformItemId, videoId)),
      );
    return rows[0];
  }

  async function getSource(playlistId: string) {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.platform, 'youtube'),
          eq(schema.sources.platformSourceId, playlistId),
        ),
      );
    return rows[0];
  }

  async function getContent(itemId: string) {
    const rows = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, itemId));
    return rows[0];
  }

  async function getChunks(itemId: string) {
    return db.select().from(schema.itemChunks).where(eq(schema.itemChunks.itemId, itemId));
  }

  async function getLinks(itemId: string) {
    return db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, itemId));
  }

  // -------------------------------------------------------------------------
  // First sync
  // -------------------------------------------------------------------------

  it('first sync persists per-playlist sources / authors / items / links + content + chunks', async () => {
    const batches: PlaylistBatch[] = [
      makeBatch(makePlaylist('pl-a', 'List A'), [
        makeVideo({ videoId: 'vid-1' }),
        makeVideo({ videoId: 'vid-2', description: '' }), // no description → no_content
      ]),
      makeBatch(makePlaylist('pl-b', 'List B'), [
        makeVideo({ videoId: 'vid-3', channelId: 'ch_bob', channelTitle: 'Bob Channel' }),
      ]),
    ];

    const result = await syncPlaylistsToDb(db, batches);
    expect(result).toMatchObject({ playlists: 2, entries: 3, inserted: 3 });
    // Auto-tagging input: content-persisted new items only — the empty-
    // description video is excluded even though its item row was inserted.
    expect(result.newItemIds).toEqual(['vid-1', 'vid-3']);

    // sources: one row per playlist, title persisted
    const sourceA = await getSource('pl-a');
    const sourceB = await getSource('pl-b');
    expect(sourceA.title).toBe('List A');
    expect(sourceB.title).toBe('List B');
    expect(sourceA.lastFetchedAt).not.toBeNull();

    // authors: alice appears twice but gets one row; channel name mapped
    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'youtube'));
    expect(authorRows).toHaveLength(2);
    const alice = authorRows.find((a) => a.platformAuthorId === 'ch_alice');
    expect(alice?.name).toBe('Alice Channel');

    // items: field mapping + platformMeta shape (addedAt + first-seen playlist)
    const item = await getItem('vid-1');
    expect(item.title).toBe('Video vid-1');
    expect(item.authorName).toBe('Alice Channel');
    expect(item.originalUrl).toBe('https://www.youtube.com/watch?v=vid-1');
    expect(item.contentState).toBe('chunked');
    expect(item.publishedAt?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(item.platformMeta).toEqual({
      description: 'original description of vid-1',
      channelId: 'ch_alice',
      channelTitle: 'Alice Channel',
      thumbnailUrl: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
      durationSeconds: 300,
      viewCount: 1000,
      likeCount: 50,
      addedAt: '2026-01-01T00:00:00Z',
      videoPublishedAt: '2025-06-01T00:00:00Z',
      playlistId: 'pl-a',
      playlistTitle: 'List A',
    });

    // empty-description video → no_content, no content/chunk rows
    const noDesc = await getItem('vid-2');
    expect(noDesc.contentState).toBe('no_content');
    expect(await getContent(noDesc.id)).toBeUndefined();
    expect(await getChunks(noDesc.id)).toHaveLength(0);

    // description persisted → item_contents + item_chunks
    const content = await getContent(item.id);
    expect(content?.plainText).toBe('original description of vid-1');
    const chunks = await getChunks(item.id);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].chunkText).toContain('original description of vid-1');

    // item_sources: links land on the right playlist source
    const linksA = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.sourceId, sourceA.id));
    expect(linksA).toHaveLength(2);
    const linksB = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.sourceId, sourceB.id));
    expect(linksB).toHaveLength(1);
  });

  it('a video in two playlists = one item + two links; first-seen playlist wins the meta', async () => {
    const shared = makeVideo({ videoId: 'vid-dup', addedAt: '2026-01-05T00:00:00Z' });
    const batches: PlaylistBatch[] = [
      makeBatch(makePlaylist('pl-a', 'List A'), [shared]),
      // Second playlist: same video, details already fetched this run →
      // membership entry only (mirrors the needsDetails dedupe in production).
      makeBatch(makePlaylist('pl-b', 'List B'), [], [
        { videoId: 'vid-dup', addedAt: '2026-02-05T00:00:00Z', videoPublishedAt: '' },
      ]),
    ];

    const result = await syncPlaylistsToDb(db, batches);
    expect(result.inserted).toBe(1);

    const itemRows = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.platform, 'youtube'));
    expect(itemRows).toHaveLength(1);

    const meta = itemRows[0].platformMeta as Record<string, unknown>;
    expect(meta.playlistId).toBe('pl-a');
    expect(meta.addedAt).toBe('2026-01-05T00:00:00Z');

    expect(await getLinks(itemRows[0].id)).toHaveLength(2);
  });

  it('platformMeta description is truncated to 500 chars, item_contents keeps full text', async () => {
    const longDescription = 'a'.repeat(480) + ' The full tail marker sentence.';
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [
        makeVideo({ videoId: 'vid-long', description: longDescription }),
      ]),
    ]);

    const item = await getItem('vid-long');
    const meta = item.platformMeta as Record<string, unknown>;
    expect((meta.description as string).length).toBe(500);
    expect(meta.description).toBe(longDescription.slice(0, 500));

    const content = await getContent(item.id);
    expect(content?.plainText).toBe(longDescription);
  });

  it('empty playlist still upserts its sources row (synced-but-empty state)', async () => {
    expect(await getLastSyncedAt(db)).toBeNull();

    const result = await syncPlaylistsToDb(db, [makeBatch(makePlaylist('pl-empty'), [])]);
    expect(result).toMatchObject({ playlists: 1, entries: 0, inserted: 0 });

    expect(await getSource('pl-empty')).toBeDefined();
    expect(await getLastSyncedAt(db)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Insert-only guard
  // -------------------------------------------------------------------------

  it('re-sync with changed metadata keeps first-write values (insert-only)', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a', 'List A'), [makeVideo({ videoId: 'vid-10' })]),
    ]);
    const before = await getSource('pl-a');

    const mutated = makeVideo({
      videoId: 'vid-10',
      title: 'RENAMED VIDEO',
      description: 'mutated description',
      channelTitle: 'Renamed Channel',
      viewCount: 999999,
      likeCount: 1,
      addedAt: '2026-02-01T00:00:00Z',
    });
    const result = await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a', 'List A RENAMED'), [mutated]),
    ]);
    expect(result.inserted).toBe(0); // nothing new → no content re-persist
    // Nothing newly persisted → auto-tagging gets an empty batch on re-sync.
    expect(result.newItemIds).toEqual([]);

    const item = await getItem('vid-10');
    expect(item.title).toBe('Video vid-10');
    const meta = item.platformMeta as Record<string, unknown>;
    expect(meta.description).toBe('original description of vid-10');
    expect(meta.viewCount).toBe(1000);
    expect(meta.addedAt).toBe('2026-01-01T00:00:00Z');

    // content untouched (persist runs for NEW items only)
    const content = await getContent(item.id);
    expect(content?.plainText).toBe('original description of vid-10');

    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'youtube'));
    expect(authorRows).toHaveLength(1);
    expect(authorRows[0].name).toBe('Alice Channel');

    // sources is the allowed exception: title + lastFetchedAt refreshed
    const after = await getSource('pl-a');
    expect(after.id).toBe(before.id);
    expect(after.title).toBe('List A RENAMED');
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('re-sync appends only new videos, without duplicating rows, links, or chunks', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [makeVideo({ videoId: 'vid-20' })]),
    ]);

    // Second run: vid-20 is known (details skipped → entry only), vid-21 is new.
    const second = await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [makeVideo({ videoId: 'vid-21' })], [
        { videoId: 'vid-20', addedAt: '2026-01-01T00:00:00Z', videoPublishedAt: '' },
      ]),
    ]);
    expect(second.inserted).toBe(1); // only vid-21 is new

    const itemRows = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.platform, 'youtube'));
    expect(itemRows).toHaveLength(2);

    const item20 = await getItem('vid-20');
    expect(await getLinks(item20.id)).toHaveLength(1);
    expect(await getChunks(item20.id)).toHaveLength(1);
  });

  it('a known video newly added to another playlist gets its link from the entry alone', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [makeVideo({ videoId: 'vid-25' })]),
    ]);

    // vid-25 already stored → next run carries it as an entry-only membership
    // of a NEW playlist (details skipped by needsDetails).
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-b'), [], [
        { videoId: 'vid-25', addedAt: '2026-03-01T00:00:00Z', videoPublishedAt: '' },
      ]),
    ]);

    const item = await getItem('vid-25');
    expect(await getLinks(item.id)).toHaveLength(2);
  });

  it('videos removed from a playlist keep their rows and links on re-sync', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [
        makeVideo({ videoId: 'vid-30' }),
        makeVideo({ videoId: 'vid-31' }),
      ]),
    ]);

    // vid-30 was removed from the playlist — re-sync returns only vid-31.
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [], [
        { videoId: 'vid-31', addedAt: '2026-01-01T00:00:00Z', videoPublishedAt: '' },
      ]),
    ]);

    const kept = await getItem('vid-30');
    expect(kept).toBeDefined();
    expect(await getLinks(kept.id)).toHaveLength(1);
  });

  it('deleted/private videos (entry without details, never stored) are skipped without error', async () => {
    const result = await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a'), [makeVideo({ videoId: 'vid-ok' })], [
        { videoId: 'vid-gone', addedAt: '2026-01-01T00:00:00Z', videoPublishedAt: '' },
      ]),
    ]);
    expect(result).toMatchObject({ entries: 2, inserted: 1 });

    expect(await getItem('vid-gone')).toBeUndefined();
    const source = await getSource('pl-a');
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.sourceId, source.id));
    expect(links).toHaveLength(1); // only vid-ok linked
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getPlaylistVideos orders by addedAt desc and paginates', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a', 'List A'), [
        makeVideo({ videoId: 'vid-40', addedAt: '2026-01-01T00:00:00Z' }),
        makeVideo({ videoId: 'vid-41', addedAt: '2026-03-01T00:00:00Z' }),
        makeVideo({ videoId: 'vid-42', addedAt: '2026-02-01T00:00:00Z' }),
      ]),
    ]);

    const page1 = await getPlaylistVideos({ page: 1, pageSize: 2 }, db);
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.videoId)).toEqual(['vid-41', 'vid-42']);
    // YoutubeVideoItem mapping sanity
    expect(page1.rows[0]).toMatchObject({
      title: 'Video vid-41',
      channelId: 'ch_alice',
      channelTitle: 'Alice Channel',
      thumbnailUrl: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
      durationSeconds: 300,
      viewCount: 1000,
      likeCount: 50,
      originalUrl: 'https://www.youtube.com/watch?v=vid-41',
      addedAt: '2026-03-01T00:00:00Z',
      videoPublishedAt: '2025-06-01T00:00:00Z',
    });

    const page2 = await getPlaylistVideos({ page: 2, pageSize: 2 }, db);
    expect(page2.rows.map((r) => r.videoId)).toEqual(['vid-40']);
  });

  it('getPlaylistVideos filters by playlist via item_sources and searches title/description', async () => {
    const shared = makeVideo({ videoId: 'vid-52', title: 'Shared video' });
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a', 'List A'), [
        makeVideo({ videoId: 'vid-50', title: 'Rust tutorial' }),
        shared,
      ]),
      makeBatch(makePlaylist('pl-b', 'List B'), [
        makeVideo({ videoId: 'vid-51', title: 'Cooking show', description: 'a fast pasta recipe' }),
      ], [toEntry(shared)]),
    ]);

    // Playlist chip filter resolves via item_sources, not platformMeta —
    // the shared video shows up under BOTH playlists.
    const byA = await getPlaylistVideos({ playlistId: 'pl-a', page: 1, pageSize: 10 }, db);
    expect(byA.rows.map((r) => r.videoId).sort()).toEqual(['vid-50', 'vid-52']);
    const byB = await getPlaylistVideos({ playlistId: 'pl-b', page: 1, pageSize: 10 }, db);
    expect(byB.rows.map((r) => r.videoId).sort()).toEqual(['vid-51', 'vid-52']);

    // search matches title...
    const byTitle = await getPlaylistVideos({ search: 'rust tut', page: 1, pageSize: 10 }, db);
    expect(byTitle.rows.map((r) => r.videoId)).toEqual(['vid-50']);

    // ...and description (case-insensitive)
    const byDesc = await getPlaylistVideos({ search: 'FAST pasta', page: 1, pageSize: 10 }, db);
    expect(byDesc.rows.map((r) => r.videoId)).toEqual(['vid-51']);

    // LIKE metacharacters in input are literal, not wildcards
    const byWildcard = await getPlaylistVideos({ search: '%', page: 1, pageSize: 10 }, db);
    expect(byWildcard.total).toBe(0);
  });

  it('getPlaylistCounts groups by playlist desc', async () => {
    await syncPlaylistsToDb(db, [
      makeBatch(makePlaylist('pl-a', 'List A'), [
        makeVideo({ videoId: 'vid-60' }),
        makeVideo({ videoId: 'vid-61' }),
      ]),
      makeBatch(makePlaylist('pl-b', 'List B'), [makeVideo({ videoId: 'vid-62' })]),
    ]);

    const counts = await getPlaylistCounts(db);
    expect(counts).toEqual([
      { playlistId: 'pl-a', title: 'List A', count: 2 },
      { playlistId: 'pl-b', title: 'List B', count: 1 },
    ]);
  });
});
