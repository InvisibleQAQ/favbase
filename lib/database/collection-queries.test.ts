import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { pagedItemsQuery, type PagedItemRow } from './collection-queries';

// A platform string nobody registered: the builders take `string` on purpose
// (lib/database/CLAUDE.md), and this file carries zero platform knowledge.
const PLATFORM = 'paged-query-test';

describe('pagedItemsQuery (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    const [author] = await db
      .insert(schema.authors)
      .values({ platform: PLATFORM, platformAuthorId: 'a1', name: 'Author' })
      .returning({ id: schema.authors.id });
    const rows = await db
      .insert(schema.items)
      .values(
        ['official', 'asr', 'plain', 'none'].map((id, index) => ({
          platform: PLATFORM,
          platformItemId: id,
          authorId: author.id,
          title: `item ${id}`,
          authorName: 'Author',
          originalUrl: `https://example.test/${id}`,
          publishedAt: new Date(Date.UTC(2026, 0, 10 - index)),
          contentState: id === 'none' ? 'pending' : 'chunked',
        })),
      )
      .returning({ id: schema.items.id, platformItemId: schema.items.platformItemId });
    const idOf = (platformItemId: string) => rows.find((r) => r.platformItemId === platformItemId)!.id;
    await db.insert(schema.itemContents).values([
      { itemId: idOf('official'), plainText: 'a transcript', subtitleSource: 'official' },
      { itemId: idOf('asr'), plainText: 'a transcript', subtitleSource: 'asr' },
      { itemId: idOf('plain'), plainText: 'post text', subtitleSource: null },
    ]);
  });

  afterAll(async () => {
    await pg.close();
  });

  function page(pageNumber: number, pageSize: number) {
    return pagedItemsQuery<PagedItemRow>(db, {
      conditions: [eq(schema.items.platform, PLATFORM)],
      orderBy: sql`${schema.items.publishedAt} DESC NULLS LAST`,
      page: pageNumber,
      pageSize,
      mapRow: (row) => row,
    });
  }

  it("carries each row's subtitle source: the transcript's method, null for plain text, null with no content row", async () => {
    const { rows, total } = await page(1, 10);

    expect(total).toBe(4);
    expect(rows.map((row) => [row.platformItemId, row.subtitleSource])).toEqual([
      ['official', 'official'],
      ['asr', 'asr'],
      ['plain', null],
      ['none', null],
    ]);
  });

  it('keeps the total and the page boundaries unchanged by the content join (one content row per item at most)', async () => {
    const first = await page(1, 3);
    const second = await page(2, 3);

    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect(first.rows.map((row) => row.platformItemId)).toEqual(['official', 'asr', 'plain']);
    expect(second.rows.map((row) => row.platformItemId)).toEqual(['none']);
  });
});
