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
import { syncFavFoldersToDb } from './favorites-sync';
import type { BiliFavFolder } from './types';

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
});
