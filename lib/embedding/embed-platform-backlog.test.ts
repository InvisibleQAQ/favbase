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
import { onDomainEvent } from '@/lib/events';
import type { ResolvedEmbeddingConfig } from './config';
import { embedPlatformBacklog, embedPlatformItem } from './indexing';

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

describe('embedPlatformBacklog', () => {
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

  it('traces Provider and persistence boundaries without logging content or vectors', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await seedItem({
      platformItemId: 'n-trace',
      contentState: 'chunked',
      chunkTexts: ['private-chunk-body'],
    });

    try {
      await embedPlatformBacklog('test', {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed: async (_config, texts) => fakeVectors(texts.length),
      });

      const traceCalls = infoSpy.mock.calls.filter(
        (call) => call[0] === '[embedding:trace]',
      );
      expect(traceCalls.map((call) => call[1])).toEqual(
        expect.arrayContaining([
          'backlog:started',
          'query:completed',
          'item:started',
          'provider:started',
          'provider:completed',
          'persistence:started',
          'persistence:completed',
          'item:completed',
          'backlog:completed',
        ]),
      );
      expect(
        traceCalls.find((call) => call[1] === 'provider:started')?.[2],
      ).toEqual(
        expect.objectContaining({
          platform: 'test',
          chunkCount: 1,
          charCount: 'private-chunk-body'.length,
          providerId: 'openai',
          model: 'm',
        }),
      );
      expect(JSON.stringify(traceCalls)).not.toContain('private-chunk-body');
      expect(JSON.stringify(traceCalls)).not.toContain('0.1');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('embeds the whole platform backlog in createdAt order without an id list', async () => {
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

    await embedPlatformBacklog('test', {
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

  it('scopes to the given platform only', async () => {
    const inScope = await seedItem({
      platformItemId: 'n-scope-in',
      contentState: 'chunked',
      chunkTexts: ['in'],
    });
    const otherPlatform = await seedItem({
      platform: 'other',
      platformItemId: 'n-scope-in',
      contentState: 'chunked',
      chunkTexts: ['other'],
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );

    await embedPlatformBacklog('test', {
      db: () => db,
      getConfig: async () => fakeConfig(true),
      embed,
    });

    expect(await getContentState(inScope)).toBe('embedded');
    expect(await getContentState(otherPlatform)).toBe('chunked');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(expect.anything(), ['in']);
  });

  it('skips non-chunked items and chunked items without chunk rows', async () => {
    const embedded = await seedItem({
      platformItemId: 'n-skip-embedded',
      contentState: 'embedded',
      chunkTexts: ['e0'],
    });
    const noContent = await seedItem({
      platformItemId: 'n-skip-no-content',
      contentState: 'no_content',
    });
    // A ghost (chunked, zero chunk rows) is excluded by the EXISTS filter —
    // it must neither be embedded nor counted into the total.
    const ghost = await seedItem({
      platformItemId: 'n-skip-ghost',
      contentState: 'chunked',
    });

    const embed = vi.fn();
    const onProgress = vi.fn();
    await embedPlatformBacklog(
      'test',
      { db: () => db, getConfig: async () => fakeConfig(true), embed },
      onProgress,
    );

    expect(embed).not.toHaveBeenCalled();
    expect(await getContentState(embedded)).toBe('embedded');
    expect(await getContentState(noContent)).toBe('no_content');
    expect(await getContentState(ghost)).toBe('chunked');
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 0, failed: 0 },
    ]);
  });

  it('continues past a failing item, then throws with the failure count', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      embedPlatformBacklog('test', {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed,
      }),
    ).rejects.toThrow('Embedding failed for 1/2 items');

    // The failing item stays 'chunked' (still in the backlog); the rest proceed.
    expect(await getContentState(itemA)).toBe('chunked');
    expect(await firstChunkEmbedding(itemA)).toBeNull();
    expect(await getContentState(itemB)).toBe('embedded');
    expect(await firstChunkEmbedding(itemB)).not.toBeNull();
    errSpy.mockRestore();
  });

  it('emits item-embedded only after each durable embedding succeeds', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedItem({
      platformItemId: 'event-fail',
      contentState: 'chunked',
      chunkTexts: ['fail-me'],
      createdAt: T0,
    });
    await seedItem({
      platformItemId: 'event-ok',
      contentState: 'chunked',
      chunkTexts: ['ok'],
      createdAt: T1,
    });
    const seen: string[] = [];
    const off = onDomainEvent('item-embedded', (event) => seen.push(event.platformItemId));

    try {
      await embedPlatformBacklog('test', {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed: async (_config, texts) => {
          if (texts.includes('fail-me')) throw new Error('boom');
          return fakeVectors(texts.length);
        },
      }).catch(() => undefined);
    } finally {
      off();
      errSpy.mockRestore();
    }

    expect(seen).toEqual(['event-ok']);
  });

  it('emits item-embedded for the single-item transcription path', async () => {
    await seedItem({
      platform: 'bilibili',
      platformItemId: 'BV-EVENT',
      contentState: 'chunked',
      chunkTexts: ['video content'],
    });
    const seen: string[] = [];
    const off = onDomainEvent('item-embedded', (event) => seen.push(event.platformItemId));

    try {
      await embedPlatformItem('bilibili', 'BV-EVENT', {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed: async (_config, texts) => fakeVectors(texts.length),
      });
    } finally {
      off();
    }

    expect(seen).toEqual(['BV-EVENT']);
  });

  it('correlates the platform-addressed single-item trace', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await seedItem({
      platform: 'bilibili',
      platformItemId: 'BV-TRACE',
      contentState: 'chunked',
      chunkTexts: ['trace me'],
    });

    try {
      await embedPlatformItem('bilibili', 'BV-TRACE', {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed: async (_config, texts) => fakeVectors(texts.length),
      });

      const traceCalls = infoSpy.mock.calls.filter(
        (call) => call[0] === '[embedding:trace]',
      );
      expect(traceCalls.map((call) => call[1])).toEqual(
        expect.arrayContaining([
          'single-item:started',
          'provider:started',
          'persistence:completed',
          'single-item:completed',
        ]),
      );
      const correlated = traceCalls.filter(
        (call) => (call[2] as { platformItemId?: string }).platformItemId === 'BV-TRACE',
      );
      expect(new Set(correlated.map((call) => (call[2] as { traceId: string }).traceId)).size)
        .toBe(1);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('completes silently at 0/0 when embedding is not configured', async () => {
    const itemId = await seedItem({
      platformItemId: 'n-disabled',
      contentState: 'chunked',
      chunkTexts: ['c0'],
    });

    const embed = vi.fn();
    const onProgress = vi.fn();
    await embedPlatformBacklog(
      'test',
      { db: () => db, getConfig: async () => fakeConfig(false), embed },
      onProgress,
    );

    expect(embed).not.toHaveBeenCalled();
    expect(await getContentState(itemId)).toBe('chunked');
    expect(await firstChunkEmbedding(itemId)).toBeNull();
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 0, failed: 0 },
    ]);
  });

  it('reports {done,total,failed} progress including failing items', async () => {
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

    await embedPlatformBacklog(
      'test',
      { db: () => db, getConfig: async () => fakeConfig(true), embed },
      onProgress,
    ).catch(() => undefined);

    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 2, failed: 0 },
      { done: 1, total: 2, failed: 1 },
      { done: 2, total: 2, failed: 1 },
    ]);
    errSpy.mockRestore();
  });

  it('checks cooperative control before claiming each item', async () => {
    await seedItem({
      platformItemId: 'c-a',
      contentState: 'chunked',
      chunkTexts: ['a0'],
      createdAt: T0,
    });
    await seedItem({
      platformItemId: 'c-b',
      contentState: 'chunked',
      chunkTexts: ['b0'],
      createdAt: T1,
    });
    const checkpoint = vi.fn(async () => {});

    await embedPlatformBacklog(
      'test',
      {
        db: () => db,
        getConfig: async () => fakeConfig(true),
        embed: async (_config, texts) => fakeVectors(texts.length),
      },
      undefined,
      { checkpoint },
    );

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });
});
