import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import type { ResolvedEmbeddingConfig } from './config';
import { embedNewItems } from './indexing';

// config.ts (pulled in by indexing.ts) value-imports `settingsStorage`, whose
// barrel eagerly touches `@wxt-dev/storage` (chrome.runtime) at load. All
// tests here inject explicit deps, so a static stub is enough. Mirrors
// rebuild.test.ts.
vi.mock('@/lib/storage', () => ({
  settingsStorage: {
    getValue: () => Promise.resolve({}),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

// indexing.ts value-imports the AI infra for its defaultDeps; stub the seam so
// module load stays hermetic (no network / provider SDK setup).
vi.mock('@/lib/ai', () => ({
  createEmbeddingModel: vi.fn(() => ({ __mock: 'model' })),
  embedTexts: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeConfig(enabled: boolean): ResolvedEmbeddingConfig {
  return { providerId: 'openai', apiKey: 'k', baseUrl: '', model: 'm', enabled };
}

// Matches the initial column width from migration v001 so these tests never
// trigger the (separately tested) lazy dimension switch.
const DIM = 1536;

function fakeVectors(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const v = new Array(DIM).fill(0);
    v[i] = 1;
    return v;
  });
}

describe('embedNewItems', () => {
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
    await db.delete(schema.items);
    await db.delete(schema.authors);
  });

  async function seedItem(opts: {
    platform?: string;
    platformItemId: string;
    contentState: string;
    chunkTexts?: string[];
    createdAt?: Date;
  }): Promise<string> {
    const platform = opts.platform ?? 'test';
    const [author] = await db
      .insert(schema.authors)
      .values({
        platform,
        platformAuthorId: `a-${opts.platformItemId}`,
        name: 'A',
      })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform,
        platformItemId: opts.platformItemId,
        authorId: author.id,
        title: 'T',
        authorName: 'A',
        originalUrl: 'http://x',
        contentState: opts.contentState,
        createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
      })
      .returning();

    if (opts.chunkTexts && opts.chunkTexts.length > 0) {
      await db.insert(schema.itemChunks).values(
        opts.chunkTexts.map((text, i) => ({
          itemId: item.id,
          chunkIndex: i,
          chunkText: text,
        })),
      );
    }
    return item.id;
  }

  async function getContentState(itemId: string): Promise<string> {
    const rows = await db
      .select({ contentState: schema.items.contentState })
      .from(schema.items)
      .where(eq(schema.items.id, itemId));
    return rows[0].contentState;
  }

  async function firstChunkEmbedding(itemId: string) {
    const rows = await db
      .select({ embedding: schema.itemChunks.embedding })
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, itemId));
    return rows[0]?.embedding ?? null;
  }

  const T0 = new Date('2026-01-01T00:00:00Z');
  const T1 = new Date('2026-01-02T00:00:00Z');

  it('embeds the listed chunked items in createdAt order', async () => {
    const itemA = await seedItem({
      platformItemId: 'n-a',
      contentState: 'chunked',
      chunkTexts: ['a0', 'a1'],
      createdAt: T0,
    });
    const itemB = await seedItem({
      platformItemId: 'n-b',
      contentState: 'chunked',
      chunkTexts: ['b0'],
      createdAt: T1,
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );

    await embedNewItems('test', ['n-a', 'n-b'], {
      db: () => db,
      getConfig: async () => fakeConfig(true),
      embed,
    });

    expect(await getContentState(itemA)).toBe('embedded');
    expect(await getContentState(itemB)).toBe('embedded');
    expect(await firstChunkEmbedding(itemA)).not.toBeNull();
    expect(await firstChunkEmbedding(itemB)).not.toBeNull();
    // Chunks read in chunk_index order, items processed oldest-first.
    expect(embed.mock.calls.map((c) => c[1])).toEqual([['a0', 'a1'], ['b0']]);
  });

  it('only touches the listed ids on the given platform', async () => {
    const inList = await seedItem({
      platformItemId: 'n-scope-in',
      contentState: 'chunked',
      chunkTexts: ['in'],
    });
    const notListed = await seedItem({
      platformItemId: 'n-scope-out',
      contentState: 'chunked',
      chunkTexts: ['out'],
    });
    // Same platformItemId on ANOTHER platform must not be picked up.
    const otherPlatform = await seedItem({
      platform: 'other',
      platformItemId: 'n-scope-in',
      contentState: 'chunked',
      chunkTexts: ['other'],
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );

    await embedNewItems('test', ['n-scope-in'], {
      db: () => db,
      getConfig: async () => fakeConfig(true),
      embed,
    });

    expect(await getContentState(inList)).toBe('embedded');
    expect(await getContentState(notListed)).toBe('chunked');
    expect(await getContentState(otherPlatform)).toBe('chunked');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(expect.anything(), ['in']);
  });

  it('skips items not at chunked and chunked items without chunk rows', async () => {
    const embedded = await seedItem({
      platformItemId: 'n-skip-embedded',
      contentState: 'embedded',
      chunkTexts: ['e0'],
    });
    const noContent = await seedItem({
      platformItemId: 'n-skip-no-content',
      contentState: 'no_content',
    });
    const chunkedEmpty = await seedItem({
      platformItemId: 'n-skip-chunked-empty',
      contentState: 'chunked',
    });

    const embed = vi.fn();
    await embedNewItems(
      'test',
      ['n-skip-embedded', 'n-skip-no-content', 'n-skip-chunked-empty'],
      { db: () => db, getConfig: async () => fakeConfig(true), embed },
    );

    expect(embed).not.toHaveBeenCalled();
    expect(await getContentState(embedded)).toBe('embedded');
    expect(await getContentState(noContent)).toBe('no_content');
    // Without chunk rows the item must NOT be advanced to 'embedded'.
    expect(await getContentState(chunkedEmpty)).toBe('chunked');
  });

  it('continues past a failing item and never throws', async () => {
    const itemA = await seedItem({
      platformItemId: 'n-fail-a',
      contentState: 'chunked',
      chunkTexts: ['fail-me'],
      createdAt: T0,
    });
    const itemB = await seedItem({
      platformItemId: 'n-fail-b',
      contentState: 'chunked',
      chunkTexts: ['ok'],
      createdAt: T1,
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) => {
      if (texts.includes('fail-me')) throw new Error('boom');
      return fakeVectors(texts.length);
    });

    await expect(
      embedNewItems('test', ['n-fail-a', 'n-fail-b'], {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed,
      }),
    ).resolves.toBeUndefined();

    // The failing item stays 'chunked' (rebuild backlog); the rest proceed.
    expect(await getContentState(itemA)).toBe('chunked');
    expect(await firstChunkEmbedding(itemA)).toBeNull();
    expect(await getContentState(itemB)).toBe('embedded');
    expect(await firstChunkEmbedding(itemB)).not.toBeNull();
  });

  it('is a silent no-op when embedding is not configured', async () => {
    const itemId = await seedItem({
      platformItemId: 'n-disabled',
      contentState: 'chunked',
      chunkTexts: ['c0'],
    });

    const embed = vi.fn();
    await embedNewItems('test', ['n-disabled'], {
      db: () => db,
      getConfig: async () => fakeConfig(false),
      embed,
    });

    expect(embed).not.toHaveBeenCalled();
    expect(await getContentState(itemId)).toBe('chunked');
    expect(await firstChunkEmbedding(itemId)).toBeNull();
  });

  it('is a no-op on an empty id list (config never read)', async () => {
    const getConfig = vi.fn();
    const embed = vi.fn();

    await embedNewItems('test', [], { db: () => db, getConfig, embed });

    expect(getConfig).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('reports onProgress starting at 0/total then incrementing to total (filtered count)', async () => {
    await seedItem({
      platformItemId: 'p-a',
      contentState: 'chunked',
      chunkTexts: ['a0'],
      createdAt: T0,
    });
    await seedItem({
      platformItemId: 'p-b',
      contentState: 'chunked',
      chunkTexts: ['b0'],
      createdAt: T1,
    });
    // no_content is filtered out — total must be 2 (the chunked count), NOT the
    // 3 input ids.
    await seedItem({ platformItemId: 'p-c', contentState: 'no_content' });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );
    const onProgress = vi.fn();

    await embedNewItems(
      'test',
      ['p-a', 'p-b', 'p-c'],
      { db: () => db, getConfig: async () => fakeConfig(true), embed },
      onProgress,
    );

    // Filtered total (2), 0-based start, monotonic increments to 2/2.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  it('advances onProgress for a failing item too (done reaches total)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedItem({
      platformItemId: 'p-fail',
      contentState: 'chunked',
      chunkTexts: ['fail-me'],
      createdAt: T0,
    });
    await seedItem({
      platformItemId: 'p-ok',
      contentState: 'chunked',
      chunkTexts: ['ok'],
      createdAt: T1,
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) => {
      if (texts.includes('fail-me')) throw new Error('boom');
      return fakeVectors(texts.length);
    });
    const onProgress = vi.fn();

    await embedNewItems(
      'test',
      ['p-fail', 'p-ok'],
      { db: () => db, getConfig: async () => fakeConfig(true), embed },
      onProgress,
    );

    // Failing item still counts toward done — the bar reaches 2/2.
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    errSpy.mockRestore();
  });
});
