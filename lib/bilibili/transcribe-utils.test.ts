import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';
import type { UserSettings } from '@/lib/storage';
import type { TranscribeResponse } from '@/lib/transcription/types';

const boundary = vi.hoisted(() => ({
  db: null as FavbaseDb | null,
  sendMessage: vi.fn(),
  embedTexts: vi.fn(),
  generateObject: vi.fn(),
}));

vi.mock('@/lib/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/database')>();
  return {
    ...actual,
    getDb: () => {
      if (!boundary.db) throw new Error('test database not initialized');
      return boundary.db;
    },
  };
});

const settings: UserSettings = {
  provider: 'openai',
  providerApiKeys: { openai: 'llm-key' },
  providerModels: { openai: 'llm-model' },
  customBaseUrl: '',
  customModel: '',
  customProtocol: 'openai',
  asrProvider: 'groq',
  asrConfigs: {},
  embeddingProvider: 'openai',
  embeddingConfigs: { openai: { apiKey: 'embedding-key', model: 'embedding-model' } },
  prefMode: 'efficiency',
  temperature: 0.3,
  maxTokens: 100000,
};

vi.mock('@/lib/storage', () => ({
  settingsStorage: {
    getValue: () => Promise.resolve(settings),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
}));

vi.mock('@/lib/ai', () => ({
  createEmbeddingModel: vi.fn(() => ({ kind: 'embedding-model' })),
  embedTexts: boundary.embedTexts,
  createLanguageModel: vi.fn(() => ({ kind: 'language-model' })),
  supportsSchemaDelivery: () => true,
}));

vi.mock('ai', () => ({
  generateObject: boundary.generateObject,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function embeddingVector(): number[] {
  const value = new Array(1536).fill(0);
  value[0] = 1;
  return value;
}

describe('transcribeAndPersist', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
    boundary.db = db;
    vi.stubGlobal('browser', {
      runtime: {
        sendMessage: boundary.sendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    boundary.db = null;
    vi.unstubAllGlobals();
    await pg.close();
  });

  async function seedItem(platformItemId: string): Promise<void> {
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'bilibili', platformAuthorId: `author-${platformItemId}`, name: 'UP' })
      .returning();
    await db.insert(schema.items).values({
      platform: 'bilibili',
      platformItemId,
      authorId: author.id,
      title: 'Concurrent pipeline',
      authorName: 'UP',
      originalUrl: `https://www.bilibili.com/video/${platformItemId}`,
    });
  }

  function successResponse(): TranscribeResponse {
    return {
      success: true,
      data: {
        rows: [{ start: 0, end: 3, text: 'content ready for both processors' }],
        source: 'asr',
        cached: false,
      },
    };
  }

  it('starts tagging while embedding is pending and completes without waiting for tagging', async () => {
    await seedItem('BV-CONCURRENT');
    const response = successResponse();
    const embedding = deferred<number[][]>();
    const tagging = deferred<{ object: { tags: string[] } }>();
    boundary.sendMessage.mockResolvedValueOnce(response);
    boundary.embedTexts.mockReturnValueOnce(embedding.promise);
    boundary.generateObject.mockReturnValueOnce(tagging.promise);
    const onIndexing = vi.fn();
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-CONCURRENT',
      'Concurrent pipeline',
      { onIndexing, onIndexed },
    );

    await vi.waitFor(() => expect(boundary.embedTexts).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(boundary.generateObject).toHaveBeenCalledTimes(1));
    expect(onIndexing).toHaveBeenCalledTimes(1);
    expect(onIndexed).not.toHaveBeenCalled();

    embedding.resolve([embeddingVector()]);

    await expect(run).resolves.toEqual(response);
    expect(onIndexed).toHaveBeenCalledWith('embedded');
    expect(boundary.generateObject).toHaveBeenCalledTimes(1);
  });

  it('emits item-content-updated after transcription content is durably persisted', async () => {
    await seedItem('BV-CONTENT-EVENT');
    boundary.sendMessage.mockResolvedValueOnce(successResponse());
    boundary.embedTexts.mockResolvedValueOnce([embeddingVector()]);
    boundary.generateObject.mockResolvedValueOnce({ object: { tags: [] } });
    const seen: string[] = [];
    const off = onDomainEvent('item-content-updated', (event) => seen.push(event.platformItemId));

    try {
      await (await import('./transcribe-utils')).transcribeAndPersist(
        'BV-CONTENT-EVENT',
        'Content event',
      );
    } finally {
      off();
    }

    expect(seen).toEqual(['BV-CONTENT-EVENT']);
  });

  it('exposes independent Embedding and Tagging promises without changing completion', async () => {
    await seedItem('BV-PROCESSING-RUNS');
    boundary.sendMessage.mockResolvedValueOnce(successResponse());
    boundary.embedTexts.mockResolvedValueOnce([embeddingVector()]);
    boundary.generateObject.mockResolvedValueOnce({ object: { tags: ['tracked'] } });
    const onEmbeddingRun = vi.fn();
    const onTaggingRun = vi.fn();

    await (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-PROCESSING-RUNS',
      'Tracked processing',
      { onEmbeddingRun, onTaggingRun },
    );

    expect(onEmbeddingRun).toHaveBeenCalledTimes(1);
    expect(onTaggingRun).toHaveBeenCalledTimes(1);
    await expect(onEmbeddingRun.mock.calls[0][0]).resolves.toBe('embedded');
    await expect(onTaggingRun.mock.calls[0][0]).resolves.toBe('tagged');
  });

  it('keeps tagging independent when embedding fails', async () => {
    await seedItem('BV-EMBED-FAIL');
    const response = successResponse();
    const tagging = deferred<{ object: { tags: string[] } }>();
    boundary.sendMessage.mockResolvedValueOnce(response);
    boundary.embedTexts.mockRejectedValueOnce(new Error('embedding unavailable'));
    boundary.generateObject.mockReturnValueOnce(tagging.promise);
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-EMBED-FAIL',
      'Concurrent pipeline',
      { onIndexed },
    );

    await expect(run).resolves.toEqual(response);
    await vi.waitFor(() => expect(boundary.generateObject).toHaveBeenCalledTimes(1));
    expect(onIndexed).toHaveBeenCalledWith('chunked');
  });

  it('starts no post-processors when transcript persistence fails', async () => {
    const response = successResponse();
    boundary.sendMessage.mockResolvedValueOnce(response);
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-MISSING',
      'Missing item',
      { onIndexed },
    );

    await expect(run).resolves.toEqual(response);
    expect(boundary.embedTexts).not.toHaveBeenCalled();
    expect(boundary.generateObject).not.toHaveBeenCalled();
    expect(onIndexed).toHaveBeenCalledWith(null);
  });

  it('keeps the combined persistContent interface backward compatible', async () => {
    await seedItem('BV-COMPAT');
    boundary.embedTexts.mockResolvedValueOnce([embeddingVector()]);

    const result = await (await import('./bili-sync-service')).persistContent(
      'BV-COMPAT',
      [{ start: 0, end: 2, text: 'compatibility path' }],
      'official',
    );

    expect(result).toBe('embedded');
  });
});
