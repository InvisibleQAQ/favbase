import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { count, eq } from 'drizzle-orm';

import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';
import type { TranscribeResponse } from '@/lib/transcription/types';
import type { PersistContentResult } from './bili-sync-service';
import type { TranscribeProcessingTicket } from './transcribe-utils';

// Boundary: the background bridge (browser.runtime) and the DB. Nothing else
// is mocked. Embedding/Tagging are not reachable from this module; the app
// runtime injects them through `startProcessing` (docs/20 item 5), so no
// provider, storage or AI mock belongs here.
const boundary = vi.hoisted(() => ({
  db: null as FavbaseDb | null,
  sendMessage: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const NEVER = new Promise<never>(() => undefined);

function settledTicket(embed: PersistContentResult = 'embedded'): TranscribeProcessingTicket {
  return { embed: Promise.resolve(embed), tag: Promise.resolve() };
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

  async function chunkCount(platformItemId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.itemChunks)
      .innerJoin(schema.items, eq(schema.items.id, schema.itemChunks.itemId))
      .where(eq(schema.items.platformItemId, platformItemId));
    return Number(row?.value ?? 0);
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

  it('hands the durable item to the injected seam and returns without awaiting either ticket', async () => {
    await seedItem('BV-PROCESSING-RUNS');
    const response = successResponse();
    boundary.sendMessage.mockResolvedValueOnce(response);
    const embedding = deferred<PersistContentResult>();
    const chunksAtStart: number[] = [];
    const startProcessing = vi.fn((bvid: string) => {
      // Probe taken when the seam fires: chunks must already be durable.
      void chunkCount(bvid).then((n) => chunksAtStart.push(n));
      return { embed: embedding.promise, tag: NEVER };
    });
    const onIndexing = vi.fn();
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-PROCESSING-RUNS',
      'Tracked processing',
      { onIndexing, onIndexed, startProcessing },
    );

    await vi.waitFor(() => expect(startProcessing).toHaveBeenCalledWith('BV-PROCESSING-RUNS'));
    expect(onIndexing).toHaveBeenCalledTimes(1);
    expect(onIndexed).not.toHaveBeenCalled();

    await expect(run).resolves.toEqual(response);
    expect(onIndexed).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(chunksAtStart).toEqual([1]));

    embedding.resolve('embedded');

    await vi.waitFor(() => expect(onIndexed).toHaveBeenCalledWith('embedded'));
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  it('emits item-content-updated after transcription content is durably persisted', async () => {
    await seedItem('BV-CONTENT-EVENT');
    boundary.sendMessage.mockResolvedValueOnce(successResponse());
    const seen: string[] = [];
    const off = onDomainEvent('item-content-updated', (event) => seen.push(event.platformItemId));

    try {
      await (await import('./transcribe-utils')).transcribeAndPersist(
        'BV-CONTENT-EVENT',
        'Content event',
        { startProcessing: () => settledTicket() },
      );
    } finally {
      off();
    }

    expect(seen).toEqual(['BV-CONTENT-EVENT']);
  });

  it('reports chunked when the Embedding ticket rejects and leaves the Tag ticket independent', async () => {
    await seedItem('BV-EMBED-FAIL');
    const response = successResponse();
    boundary.sendMessage.mockResolvedValueOnce(response);
    const embedding = deferred<PersistContentResult>();
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-EMBED-FAIL',
      'Concurrent pipeline',
      { onIndexed, startProcessing: () => ({ embed: embedding.promise, tag: NEVER }) },
    );

    await expect(run).resolves.toEqual(response);
    expect(onIndexed).not.toHaveBeenCalled();

    embedding.reject(new Error('embedding unavailable'));

    await vi.waitFor(() => expect(onIndexed).toHaveBeenCalledWith('chunked'));
    expect(onIndexed).toHaveBeenCalledTimes(1);
  });

  it('starts no post-processors when transcript persistence fails', async () => {
    const response = successResponse();
    boundary.sendMessage.mockResolvedValueOnce(response);
    const startProcessing = vi.fn(() => settledTicket());
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-MISSING',
      'Missing item',
      { onIndexed, startProcessing },
    );

    await expect(run).resolves.toEqual(response);
    expect(startProcessing).not.toHaveBeenCalled();
    expect(onIndexed).toHaveBeenCalledWith(null);
  });

  it('neither persists nor starts post-processors when transcription fails', async () => {
    await seedItem('BV-TRANSCRIBE-FAIL');
    const response: TranscribeResponse = {
      success: false,
      error: { code: 'ASR_UNKNOWN', message: 'boom' },
    };
    boundary.sendMessage.mockResolvedValueOnce(response);
    const startProcessing = vi.fn(() => settledTicket());
    const onIndexing = vi.fn();
    const onIndexed = vi.fn();

    const run = (await import('./transcribe-utils')).transcribeAndPersist(
      'BV-TRANSCRIBE-FAIL',
      'Failed transcription',
      { onIndexing, onIndexed, startProcessing },
    );

    await expect(run).resolves.toEqual(response);
    expect(onIndexing).not.toHaveBeenCalled();
    expect(onIndexed).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();
    await expect(chunkCount('BV-TRANSCRIBE-FAIL')).resolves.toBe(0);
  });
});
