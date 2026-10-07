import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { rebuildPendingEmbeddings } from './indexing';

/**
 * The one path no injected `IndexingDeps` covers: `defaultDeps`, which resolves
 * the embedding settings and wires them into the provider call. The lanes and
 * the rebuild are tested with injected deps in embed-platform-backlog.test.ts /
 * rebuild.test.ts; this file pins what the real default forwards.
 */

// config.ts (pulled in by indexing.ts) reads settings through the storage LEAF
// (the barrel would also evaluate ui-state/agent-bridge items at load), so
// mock the leaf with mutable state the test can feed. Mirrors config.test.ts.
const mockSettings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/lib/storage/settings', () => ({
  settingsStorage: {
    getValue: () => Promise.resolve(mockSettings.value),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

// Mock the AI infra so the defaultDeps path can be exercised without network:
// assert createEmbeddingModel/embedTexts receive the resolved config's
// providerId + dimensions.
const aiMock = vi.hoisted(() => ({
  createEmbeddingModel: vi.fn(() => ({ __mock: 'model' })),
  embedTexts: vi.fn(),
}));
vi.mock('@/lib/ai', () => ({
  createEmbeddingModel: aiMock.createEmbeddingModel,
  embedTexts: aiMock.embedTexts,
}));

// Matches the initial column width from migration v001 so the test never
// triggers the (separately tested) lazy dimension switch.
const DIM = 1536;

function fakeVectors(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => {
    const v = new Array(DIM).fill(0);
    v[i] = 1;
    return v;
  });
}

describe('indexing defaultDeps', () => {
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

  /** One item at the durable 'chunked' seam with the given chunk rows. */
  async function seedChunkedItem(platformItemId: string, chunkTexts: string[]): Promise<string> {
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
        contentState: 'chunked',
      })
      .returning();
    await db
      .insert(schema.itemChunks)
      .values(chunkTexts.map((text, i) => ({ itemId: item.id, chunkIndex: i, chunkText: text })));
    return item.id;
  }

  it('forwards providerId + dimensions from the resolved config into embedTexts', async () => {
    const itemId = await seedChunkedItem('i-default-deps-dims', ['chunk zero', 'chunk one']);
    // Hermetic: a developer's real .env.local (VITE_EMBEDDING_*) must not leak
    // into resolveEmbeddingConfig here.
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', '');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
    mockSettings.value = {
      embeddingProvider: 'openai',
      embeddingConfigs: { openai: { apiKey: 'k', model: 'm', dimensions: 1024 } },
    };
    aiMock.embedTexts.mockImplementation(async (_model: unknown, texts: string[]) =>
      fakeVectors(texts.length),
    );

    try {
      // No deps injected → real defaultDeps: getEmbeddingSettings → resolver →
      // createEmbeddingModel + embedTexts (both mocked at the @/lib/ai seam).
      const outcome = await rebuildPendingEmbeddings(db);

      expect(outcome).toEqual({ status: 'completed', completed: 1, total: 1 });
      expect(aiMock.createEmbeddingModel).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'openai', apiKey: 'k', model: 'm' }),
      );
      expect(aiMock.embedTexts).toHaveBeenCalledWith(
        expect.anything(),
        ['chunk zero', 'chunk one'],
        { providerId: 'openai', dimensions: 1024 },
      );
      const [row] = await db
        .select({ contentState: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, itemId));
      expect(row.contentState).toBe('embedded');
    } finally {
      mockSettings.value = {};
      vi.unstubAllEnvs();
    }
  });
});
