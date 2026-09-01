import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import type { ResolvedEmbeddingConfig } from './config';
import { rebuildPendingEmbeddings, type IndexingDeps } from './indexing';

// config.ts (pulled in by indexing.ts) value-imports `settingsStorage`, whose
// barrel eagerly touches `@wxt-dev/storage` (chrome.runtime) at load. All
// rebuild tests inject explicit IndexingDeps, so a static stub is enough.
// Mirrors indexing.test.ts.
// `config.ts` reads settings through the storage LEAF (the barrel would also
// evaluate ui-state/agent-bridge items at load), so mock the leaf.
vi.mock('@/lib/storage/settings', () => ({
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

describe('rebuildPendingEmbeddings', () => {
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

  // The rebuild scans the WHOLE items table — wipe between tests so one
  // test's backlog never leaks into another (items cascade-delete chunks).
  afterEach(async () => {
    await db.delete(schema.items);
    await db.delete(schema.authors);
  });

  /**
   * Seed an item in a given content_state with optional chunk rows. Explicit
   * `createdAt` pins the deterministic processing order (rebuild sorts by it).
   */
  async function seedItem(opts: {
    platform?: string;
    platformItemId: string;
    contentState: string;
    chunkTexts?: string[];
    createdAt: Date;
    platformMeta?: Record<string, unknown>;
  }): Promise<string> {
    const platform = opts.platform ?? 'test';
    const [author] = await db
      .insert(schema.authors)
      .values({ platform, platformAuthorId: `a-${opts.platformItemId}`, name: 'A' })
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
        createdAt: opts.createdAt,
        platformMeta: opts.platformMeta ?? {},
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

  function getChunks(itemId: string) {
    return db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, itemId))
      .orderBy(asc(schema.itemChunks.chunkIndex));
  }

  const T0 = new Date('2026-01-01T00:00:00Z');
  const T1 = new Date('2026-01-02T00:00:00Z');

  it('re-embeds the whole backlog with ordered progress callbacks', async () => {
    const itemA = await seedItem({
      platformItemId: 'r-happy-a',
      contentState: 'chunked',
      chunkTexts: ['a0', 'a1'],
      createdAt: T0,
    });
    const itemB = await seedItem({
      platformItemId: 'r-happy-b',
      contentState: 'chunked',
      chunkTexts: ['b0'],
      createdAt: T1,
    });

    const embed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );
    const onProgress = vi.fn();

    const outcome = await rebuildPendingEmbeddings(
      db,
      { getConfig: async () => fakeConfig(true), embed },
      onProgress,
    );

    expect(outcome).toEqual({ status: 'completed', completed: 2, total: 2 });
    expect(await getContentState(itemA)).toBe('embedded');
    expect(await getContentState(itemB)).toBe('embedded');

    // Chunks are read from the DB in chunk_index order, item A (older) first.
    expect(embed.mock.calls.map((c) => c[1])).toEqual([['a0', 'a1'], ['b0']]);

    const chunksA = await getChunks(itemA);
    const chunksB = await getChunks(itemB);
    expect(chunksA.every((c) => c.embedding !== null)).toBe(true);
    expect(chunksB.every((c) => c.embedding !== null)).toBe(true);

    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { completed: 0, total: 2 },
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);
  });

  it('excludes Collection Items rejected by the shared processing policy', async () => {
    const valid = await seedItem({
      platformItemId: 'r-policy-valid',
      contentState: 'chunked',
      chunkTexts: ['valid'],
      createdAt: T0,
    });
    const invalid = await seedItem({
      platform: 'bilibili',
      platformItemId: 'r-policy-invalid',
      contentState: 'chunked',
      chunkTexts: ['invalid'],
      createdAt: T1,
      platformMeta: { attr: 9 },
    });
    const embed = vi.fn(async (_config: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );

    const outcome = await rebuildPendingEmbeddings(db, {
      getConfig: async () => fakeConfig(true),
      embed,
    });

    expect(outcome).toEqual({ status: 'completed', completed: 1, total: 1 });
    expect(await getContentState(valid)).toBe('embedded');
    expect(await getContentState(invalid)).toBe('chunked');
    expect(embed).toHaveBeenCalledWith(expect.anything(), ['valid']);
  });

  it('stops at the first failing item and resumes with only the remainder', async () => {
    const itemA = await seedItem({
      platformItemId: 'r-resume-a',
      contentState: 'chunked',
      chunkTexts: ['ok'],
      createdAt: T0,
    });
    const itemB = await seedItem({
      platformItemId: 'r-resume-b',
      contentState: 'chunked',
      chunkTexts: ['fail-me'],
      createdAt: T1,
    });

    const failingEmbed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) => {
      if (texts.includes('fail-me')) throw new Error('boom');
      return fakeVectors(texts.length);
    });

    await expect(
      rebuildPendingEmbeddings(db, {
        getConfig: async () => fakeConfig(true),
        embed: failingEmbed,
      }),
    ).rejects.toThrow('boom');

    // Finished item keeps its progress; the failing one stays 'chunked'.
    expect(await getContentState(itemA)).toBe('embedded');
    expect(await getContentState(itemB)).toBe('chunked');
    expect((await getChunks(itemA))[0].embedding).not.toBeNull();
    expect((await getChunks(itemB))[0].embedding).toBeNull();

    // Second run only sees the remainder — idempotent resume.
    const workingEmbed = vi.fn(async (_c: ResolvedEmbeddingConfig, texts: string[]) =>
      fakeVectors(texts.length),
    );
    const outcome = await rebuildPendingEmbeddings(db, {
      getConfig: async () => fakeConfig(true),
      embed: workingEmbed,
    });

    expect(outcome).toEqual({ status: 'completed', completed: 1, total: 1 });
    expect(workingEmbed).toHaveBeenCalledTimes(1);
    expect(workingEmbed).toHaveBeenCalledWith(expect.anything(), ['fail-me']);
    expect(await getContentState(itemB)).toBe('embedded');
    expect((await getChunks(itemB))[0].embedding).not.toBeNull();
  });

  it('returns not-configured without touching the DB when embedding is disabled', async () => {
    const itemId = await seedItem({
      platformItemId: 'r-disabled',
      contentState: 'chunked',
      chunkTexts: ['c0'],
      createdAt: T0,
    });

    const embed = vi.fn();
    const onProgress = vi.fn();
    const outcome = await rebuildPendingEmbeddings(
      db,
      { getConfig: async () => fakeConfig(false), embed },
      onProgress,
    );

    expect(outcome).toEqual({ status: 'not-configured' });
    expect(embed).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(await getContentState(itemId)).toBe('chunked');
    expect((await getChunks(itemId))[0].embedding).toBeNull();
  });

  it('completes normally on an empty backlog (total = 0)', async () => {
    const embed = vi.fn();
    const onProgress = vi.fn();

    const outcome = await rebuildPendingEmbeddings(
      db,
      { getConfig: async () => fakeConfig(true), embed },
      onProgress,
    );

    expect(outcome).toEqual({ status: 'completed', completed: 0, total: 0 });
    expect(embed).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([{ completed: 0, total: 0 }]);
  });

  it('ignores items in other states and chunked items without chunks', async () => {
    const seeded = {
      pending: await seedItem({
        platformItemId: 'r-skip-pending',
        contentState: 'pending',
        createdAt: T0,
      }),
      hasContent: await seedItem({
        platformItemId: 'r-skip-has-content',
        contentState: 'has_content',
        createdAt: T0,
      }),
      embedded: await seedItem({
        platformItemId: 'r-skip-embedded',
        contentState: 'embedded',
        chunkTexts: ['e0'],
        createdAt: T0,
      }),
      error: await seedItem({
        platformItemId: 'r-skip-error',
        contentState: 'error',
        chunkTexts: ['x0'],
        createdAt: T0,
      }),
      noContent: await seedItem({
        platformItemId: 'r-skip-no-content',
        contentState: 'no_content',
        createdAt: T0,
      }),
      chunkedEmpty: await seedItem({
        platformItemId: 'r-skip-chunked-empty',
        contentState: 'chunked',
        createdAt: T0,
      }),
    };

    const embed = vi.fn();
    const outcome = await rebuildPendingEmbeddings(db, {
      getConfig: async () => fakeConfig(true),
      embed,
    });

    expect(outcome).toEqual({ status: 'completed', completed: 0, total: 0 });
    expect(embed).not.toHaveBeenCalled();
    expect(await getContentState(seeded.pending)).toBe('pending');
    expect(await getContentState(seeded.hasContent)).toBe('has_content');
    expect(await getContentState(seeded.embedded)).toBe('embedded');
    expect(await getContentState(seeded.error)).toBe('error');
    expect(await getContentState(seeded.noContent)).toBe('no_content');
    expect(await getContentState(seeded.chunkedEmpty)).toBe('chunked');
  });
});
