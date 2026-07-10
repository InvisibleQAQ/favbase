import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq, isNotNull, and } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import type { ResolvedEmbeddingConfig } from './config';
import { indexItemChunks, type IndexingDeps } from './indexing';
import type { ChunkInput } from './types';

// config.ts (pulled in by indexing.ts) value-imports `settingsStorage`, whose
// barrel eagerly touches `@wxt-dev/storage` (chrome.runtime) at load. Stub it
// out — every test here injects explicit IndexingDeps. Mirrors config.test.ts.
vi.mock('@/lib/storage', () => ({
  settingsStorage: {
    getValue: () => Promise.resolve({}),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeConfig(enabled: boolean): ResolvedEmbeddingConfig {
  return { providerId: 'openai', apiKey: 'k', baseUrl: '', model: 'm', enabled };
}

// Matches the initial column width from migration v001; any dimension <= 2000
// would work now that upsert lazily re-dimensions the column.
const DIM = 1536;

function fakeVectors(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const v = new Array(DIM).fill(0);
    v[i] = 1;
    return v;
  });
}

const CHUNKS: ChunkInput[] = [
  { text: 'chunk zero', startSec: 0, endSec: 12.5 },
  { text: 'chunk one', startSec: 10, endSec: 30 },
];

describe('indexItemChunks', () => {
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

  /** Fresh item per test — content_state assertions must not leak across tests. */
  async function seedItem(platformItemId: string): Promise<string> {
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'test', platformAuthorId: `a-${platformItemId}`, name: 'A' })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform: 'test',
        platformItemId,
        authorId: author.id,
        title: 'T',
        authorName: 'A',
        originalUrl: 'http://x',
      })
      .returning();
    return item.id;
  }

  async function getContentState(itemId: string): Promise<string> {
    const rows = await db
      .select({ contentState: schema.items.contentState })
      .from(schema.items)
      .where(eq(schema.items.id, itemId));
    return rows[0].contentState;
  }

  function getChunks(itemId: string) {
    return db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, itemId))
      .orderBy(asc(schema.itemChunks.chunkIndex));
  }

  it('persists chunks with sequential index + timestamps, stays chunked when disabled', async () => {
    const itemId = await seedItem('i-disabled');
    const embed = vi.fn();
    const deps: IndexingDeps = { getConfig: async () => fakeConfig(false), embed };

    const state = await indexItemChunks(db, itemId, CHUNKS, deps);

    expect(state).toBe('chunked');
    expect(await getContentState(itemId)).toBe('chunked');
    expect(embed).not.toHaveBeenCalled();

    const rows = await getChunks(itemId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.chunkIndex)).toEqual([0, 1]);
    expect(rows.map((r) => r.chunkText)).toEqual(['chunk zero', 'chunk one']);
    expect(rows[0].startSec).toBe(0);
    expect(rows[0].endSec).toBe(12.5);
    expect(rows[1].startSec).toBe(10);
    expect(rows[1].endSec).toBe(30);
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it('embeds and advances to embedded with injected embed deps', async () => {
    const itemId = await seedItem('i-embedded');
    const deps: IndexingDeps = {
      getConfig: async () => fakeConfig(true),
      embed: async (_config, texts) => fakeVectors(texts.length),
    };

    const state = await indexItemChunks(db, itemId, CHUNKS, deps);

    expect(state).toBe('embedded');
    expect(await getContentState(itemId)).toBe('embedded');

    const rows = await db
      .select({ id: schema.itemChunks.id })
      .from(schema.itemChunks)
      .where(
        and(eq(schema.itemChunks.itemId, itemId), isNotNull(schema.itemChunks.embedding)),
      );
    expect(rows).toHaveLength(2);
  });

  it('stays chunked without throwing when embed fails', async () => {
    const itemId = await seedItem('i-embed-fail');
    const deps: IndexingDeps = {
      getConfig: async () => fakeConfig(true),
      embed: async () => {
        throw new Error('network down');
      },
    };

    const state = await indexItemChunks(db, itemId, CHUNKS, deps);

    expect(state).toBe('chunked');
    expect(await getContentState(itemId)).toBe('chunked');
    const rows = await getChunks(itemId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it('stays chunked without throwing when getConfig fails', async () => {
    const itemId = await seedItem('i-config-fail');
    const deps: IndexingDeps = {
      getConfig: async () => {
        throw new Error('storage unavailable');
      },
      embed: vi.fn(),
    };

    const state = await indexItemChunks(db, itemId, CHUNKS, deps);

    expect(state).toBe('chunked');
    expect(await getContentState(itemId)).toBe('chunked');
  });

  it('re-indexing rebuilds chunks without residue or conflicts', async () => {
    const itemId = await seedItem('i-reindex');
    const deps: IndexingDeps = { getConfig: async () => fakeConfig(false), embed: vi.fn() };

    const first: ChunkInput[] = [
      { text: 'old zero', startSec: 0, endSec: 1 },
      { text: 'old one', startSec: 1, endSec: 2 },
      { text: 'old two', startSec: 2, endSec: 3 },
    ];
    await indexItemChunks(db, itemId, first, deps);

    const second: ChunkInput[] = [
      { text: 'new zero', startSec: 0, endSec: 5 },
      { text: 'new one', startSec: 5, endSec: 9 },
    ];
    await indexItemChunks(db, itemId, second, deps);

    const rows = await getChunks(itemId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.chunkIndex)).toEqual([0, 1]);
    expect(rows.map((r) => r.chunkText)).toEqual(['new zero', 'new one']);
  });

  it('stores NULL timestamps for non-timed chunks (article-style input)', async () => {
    const itemId = await seedItem('i-untimed');
    const deps: IndexingDeps = { getConfig: async () => fakeConfig(false), embed: vi.fn() };

    await indexItemChunks(db, itemId, [{ text: 'article chunk' }], deps);

    const rows = await getChunks(itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0].startSec).toBeNull();
    expect(rows[0].endSec).toBeNull();
  });

  it('empty chunks clears existing rows and stays chunked', async () => {
    const itemId = await seedItem('i-empty');
    const deps: IndexingDeps = { getConfig: async () => fakeConfig(true), embed: vi.fn() };

    await indexItemChunks(db, itemId, CHUNKS, { ...deps, getConfig: async () => fakeConfig(false) });
    expect(await getChunks(itemId)).toHaveLength(2);

    const state = await indexItemChunks(db, itemId, [], deps);

    expect(state).toBe('chunked');
    expect(await getChunks(itemId)).toHaveLength(0);
    expect(deps.embed).not.toHaveBeenCalled();
  });
});
