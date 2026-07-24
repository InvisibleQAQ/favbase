import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import {
  getFavoriteVideoSyncBaseline,
  markVideoHistoryComplete,
  syncFavFoldersToDb,
} from './favorites-sync';
import { syncFavVideosToDb } from './videos-sync';
import type { BiliFavFolder, BiliFavVideo } from './types';

function makeFolder(overrides: Partial<BiliFavFolder> = {}): BiliFavFolder {
  return {
    id: 42,
    fid: 7,
    mid: 100,
    title: 'Folder',
    media_count: 3,
    cover: 'https://example.com/cover.jpg',
    intro: 'intro',
    ctime: 1,
    mtime: 2,
    attr: 0,
    fav_state: 1,
    ...overrides,
  };
}

function makeVideo(bvid: string): BiliFavVideo {
  return {
    id: 1,
    type: 2,
    title: bvid,
    cover: '',
    intro: '',
    duration: 60,
    bvid,
    upper: { mid: 1, name: 'UP', face: '' },
    cnt_info: { play: 0, collect: 0, danmaku: 0 },
    fav_time: 0,
    attr: 0,
  };
}

describe('syncFavFoldersToDb', () => {
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

  it('normalizes source metadata and refreshes mutable folder fields', async () => {
    await syncFavFoldersToDb(db, [makeFolder()]);
    const refreshed = await syncFavFoldersToDb(db, [
      makeFolder({ title: 'Renamed', media_count: 9, mtime: 10 }),
    ]);

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].title).toBe('Renamed');
    expect(refreshed[0].platformMeta).toMatchObject({
      mlid: 42,
      fid: 7,
      media_count: 9,
      mtime: 10,
    });
    await expect(
      db
        .select()
        .from(schema.sources)
        .where(
          and(
            eq(schema.sources.platform, 'bilibili'),
            eq(schema.sources.platformSourceId, '42'),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it('preserves the completed video-history marker when folder metadata refreshes', async () => {
    const [source] = await syncFavFoldersToDb(db, [makeFolder({ id: 43, title: 'Before' })]);
    await db
      .update(schema.sources)
      .set({
        platformMeta: {
          ...(source.platformMeta as Record<string, unknown>),
          videos_sync_complete: true,
        },
      })
      .where(eq(schema.sources.id, source.id));

    const [refreshed] = await syncFavFoldersToDb(db, [
      makeFolder({ id: 43, title: 'After', media_count: 11 }),
    ]);

    expect(refreshed.title).toBe('After');
    expect(refreshed.platformMeta).toMatchObject({
      media_count: 11,
      videos_sync_complete: true,
    });
  });

  it('marks a folder video history complete after a successful full sync', async () => {
    await syncFavFoldersToDb(db, [makeFolder({ id: 44 })]);

    await markVideoHistoryComplete(db, '44');

    const [source] = await db
      .select()
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.platform, 'bilibili'),
          eq(schema.sources.platformSourceId, '44'),
        ),
      );
    expect(source.platformMeta).toMatchObject({ videos_sync_complete: true });
  });

  it('scopes the existing-video baseline to the requested folder', async () => {
    await syncFavFoldersToDb(db, [makeFolder({ id: 45 }), makeFolder({ id: 46 })]);
    await syncFavVideosToDb(db, [makeVideo('BV-IN-B')], '46');

    const [folderA, folderB] = await Promise.all([
      getFavoriteVideoSyncBaseline(db, '45'),
      getFavoriteVideoSyncBaseline(db, '46'),
    ]);

    expect([...folderA.existingBvids]).toEqual([]);
    expect([...folderB.existingBvids]).toEqual(['BV-IN-B']);
  });
});
