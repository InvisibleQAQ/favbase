import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import {
  INVALID_VIDEO_ATTR,
  bilibiliDownstreamEligibleSql,
  isProcessableVideo,
} from './video-eligibility';

/**
 * One fixture, two readers. The in-memory predicate (UI cards, manual and
 * auto transcription) and the SQL predicate (shared Collection processing
 * policy) must agree on every attr value — a drift between them is exactly
 * the "one place updated, the other not" defect docs/20 高-4 describes.
 */
const FIXTURE: ReadonlyArray<{ id: string; attr: number | undefined }> = [
  { id: 'attr-0', attr: 0 },
  { id: 'attr-1', attr: 1 },
  { id: 'attr-9', attr: INVALID_VIDEO_ATTR },
  { id: 'attr-missing', attr: undefined },
];

describe('isProcessableVideo', () => {
  it('rejects only the invalid attr', () => {
    expect(isProcessableVideo({ attr: INVALID_VIDEO_ATTR })).toBe(false);
    expect(isProcessableVideo({ attr: 0 })).toBe(true);
    expect(isProcessableVideo({ attr: 1 })).toBe(true);
  });
});

describe('bilibiliDownstreamEligibleSql parity (in-memory PGlite)', () => {
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

  it('matches the in-memory predicate for every attr fixture', async () => {
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'bilibili', platformAuthorId: 'parity-author', name: 'Author' })
      .returning({ id: schema.authors.id });
    await db.insert(schema.items).values(
      FIXTURE.map((row) => ({
        platform: 'bilibili',
        platformItemId: row.id,
        authorId: author.id,
        authorName: 'Author',
        title: row.id,
        originalUrl: `https://example.test/${row.id}`,
        platformMeta: row.attr === undefined ? {} : { attr: row.attr },
      })),
    );

    const rows = await db
      .select({ id: schema.items.platformItemId })
      .from(schema.items)
      .where(bilibiliDownstreamEligibleSql())
      .orderBy(schema.items.platformItemId);

    // Missing attr reads as 0 everywhere a card is rebuilt from platform_meta.
    const expected = FIXTURE.filter((row) => isProcessableVideo({ attr: row.attr ?? 0 }))
      .map((row) => row.id)
      .sort();

    expect(rows.map((row) => row.id)).toEqual(expected);
    expect(expected).toEqual(['attr-0', 'attr-1', 'attr-missing']);
  });
});
