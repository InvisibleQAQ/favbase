import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database/db';

// bili-sync-service resolves the shared proxy via getDb(); point it at an
// in-memory PGlite (same infra as videos-sync.test.ts). The '@/lib/embedding'
// barrel touches chrome.storage at module load — stub the names the service
// imports from it.
const state = vi.hoisted(() => ({ db: null as unknown as FavbaseDb }));
vi.mock('@/lib/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/database')>();
  return { ...actual, getDb: () => state.db };
});
vi.mock('@/lib/embedding', () => ({
  chunkSubtitleRows: vi.fn(),
  embedPlatformItem: vi.fn(),
}));

import { listFoldersWithPending } from './bili-sync-service';

describe('listFoldersWithPending', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    state.db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
    const db = state.db;

    // Folders: f1 has a pending video, f2 only a chunked one, f3 is empty,
    // f4 has TWO pending videos (exercises the DISTINCT collapse). A zhihu
    // source reuses the id 'f2' WITH a pending item — platform scoping must
    // keep it out of the bilibili answer.
    const sourceRows = await db
      .insert(schema.sources)
      .values([
        { platform: 'bilibili', platformSourceId: 'f1', title: 'Folder 1' },
        { platform: 'bilibili', platformSourceId: 'f2', title: 'Folder 2' },
        { platform: 'bilibili', platformSourceId: 'f3', title: 'Folder 3' },
        { platform: 'bilibili', platformSourceId: 'f4', title: 'Folder 4' },
        { platform: 'zhihu', platformSourceId: 'f2', title: 'Zhihu f2' },
      ])
      .returning();
    const sourceId = new Map(
      sourceRows.map((r) => [`${r.platform}:${r.platformSourceId}`, r.id]),
    );

    const authorRows = await db
      .insert(schema.authors)
      .values([
        { platform: 'bilibili', platformAuthorId: 'a1', name: 'Author' },
        { platform: 'zhihu', platformAuthorId: 'z1', name: 'Zhihu Author' },
      ])
      .returning();

    const itemRows = await db
      .insert(schema.items)
      .values([
        {
          platform: 'bilibili',
          platformItemId: 'BV1',
          authorId: authorRows[0].id,
          title: 'pending video',
          authorName: 'Author',
          originalUrl: 'https://example.com/BV1',
          contentState: 'pending',
        },
        {
          platform: 'bilibili',
          platformItemId: 'BV2',
          authorId: authorRows[0].id,
          title: 'chunked video',
          authorName: 'Author',
          originalUrl: 'https://example.com/BV2',
          contentState: 'chunked',
        },
        {
          platform: 'bilibili',
          platformItemId: 'BV3',
          authorId: authorRows[0].id,
          title: 'pending video in f4',
          authorName: 'Author',
          originalUrl: 'https://example.com/BV3',
          contentState: 'pending',
        },
        {
          platform: 'bilibili',
          platformItemId: 'BV4',
          authorId: authorRows[0].id,
          title: 'second pending video in f4',
          authorName: 'Author',
          originalUrl: 'https://example.com/BV4',
          contentState: 'pending',
        },
        {
          platform: 'zhihu',
          platformItemId: 'Z1',
          authorId: authorRows[1].id,
          title: 'pending zhihu item',
          authorName: 'Zhihu Author',
          originalUrl: 'https://example.com/Z1',
          contentState: 'pending',
        },
      ])
      .returning();

    await db.insert(schema.itemSources).values([
      { itemId: itemRows[0].id, sourceId: sourceId.get('bilibili:f1')! },
      { itemId: itemRows[1].id, sourceId: sourceId.get('bilibili:f2')! },
      { itemId: itemRows[2].id, sourceId: sourceId.get('bilibili:f4')! },
      { itemId: itemRows[3].id, sourceId: sourceId.get('bilibili:f4')! },
      { itemId: itemRows[4].id, sourceId: sourceId.get('zhihu:f2')! },
    ]);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('returns only folders with >=1 pending video, preserving input order', async () => {
    await expect(listFoldersWithPending(['f3', 'f1', 'f2'])).resolves.toEqual(['f1']);
    await expect(listFoldersWithPending(['f1', 'f3'])).resolves.toEqual(['f1']);
  });

  it('preserves caller order across multiple survivors, one entry per folder', async () => {
    // f4 holds two pending videos — DISTINCT must collapse it to one entry,
    // and the answer must follow the INPUT order, not the DB row order.
    await expect(listFoldersWithPending(['f4', 'f2', 'f1'])).resolves.toEqual(['f4', 'f1']);
    await expect(listFoldersWithPending(['f1', 'f4'])).resolves.toEqual(['f1', 'f4']);
  });

  it('returns [] for empty input and for folders without pending work', async () => {
    await expect(listFoldersWithPending([])).resolves.toEqual([]);
    await expect(listFoldersWithPending(['nope', 'f2', 'f3'])).resolves.toEqual([]);
  });

  it('is platform-scoped: zhihu pending on the same source id does not leak', async () => {
    await expect(listFoldersWithPending(['f2'])).resolves.toEqual([]);
  });
});
