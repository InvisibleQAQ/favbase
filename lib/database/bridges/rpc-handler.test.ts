import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { replaceItemChunks } from '@/lib/embedding/vector-store';
import type { RpcRequest, RpcResponse, RpcTransport } from './types';
import { PGliteSharedProxy } from './proxy-driver';
import { DatabaseRpcHandler } from './rpc-handler';

const CHANNEL_NAME = 'test-database-rpc';

type PortMessageListener = (message: unknown) => void;
type PortConnectListener = (port: chrome.runtime.Port) => void;

interface TestRpcClient {
  transport: RpcTransport;
  disconnect(): void;
}

describe('DatabaseRpcHandler transaction ownership', () => {
  let pg: PGlite;
  let connectListener: PortConnectListener;
  let proxyA: PGliteSharedProxy;
  let proxyB: PGliteSharedProxy;
  let dbA: FavbaseDb;
  let dbB: FavbaseDb;

  let rawRequestId = 8_000_000_000_000_000;

  function createClient(): TestRpcClient {
    let requestListener: PortMessageListener | null = null;
    let disconnectListener: (() => void) | null = null;
    const responseListeners = new Set<(response: RpcResponse) => void>();
    const port = {
      name: CHANNEL_NAME,
      onMessage: {
        addListener(listener: PortMessageListener) {
          requestListener = listener;
        },
      },
      onDisconnect: {
        addListener(listener: () => void) {
          disconnectListener = listener;
        },
      },
      postMessage(message: RpcResponse) {
        for (const listener of responseListeners) listener(message);
      },
    } as unknown as chrome.runtime.Port;

    connectListener(port);

    return {
      transport: {
        post(request: RpcRequest) {
          queueMicrotask(() => requestListener?.(request));
        },
        subscribe(listener) {
          responseListeners.add(listener);
          return () => responseListeners.delete(listener);
        },
      },
      disconnect() {
        disconnectListener?.();
      },
    };
  }

  function callRaw(
    client: TestRpcClient,
    request: Omit<RpcRequest, 'id'>,
  ): Promise<RpcResponse> {
    return callRawWithId(client, ++rawRequestId, request);
  }

  function callRawWithId(
    client: TestRpcClient,
    id: number,
    request: Omit<RpcRequest, 'id'>,
  ): Promise<RpcResponse> {
    return new Promise((resolve) => {
      const unsubscribe = client.transport.subscribe((response) => {
        if (response.id !== id) return;
        unsubscribe();
        resolve(response);
      });
      client.transport.post({ ...request, id });
    });
  }

  beforeAll(async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        onConnect: {
          addListener(listener: PortConnectListener) {
            connectListener = listener;
          },
        },
      },
    });

    const handler = DatabaseRpcHandler.getInstance();
    handler.startListening(CHANNEL_NAME);
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    await pg.exec(`
      CREATE TABLE transaction_probe (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE deferred_commit_probe (
        value INTEGER,
        CONSTRAINT deferred_commit_probe_unique
          UNIQUE (value) DEFERRABLE INITIALLY DEFERRED
      );
    `);
    handler.setPGlite(pg);

    proxyA = new PGliteSharedProxy(createClient().transport);
    proxyB = new PGliteSharedProxy(createClient().transport);
    await Promise.all([proxyA.waitReady, proxyB.waitReady]);
    dbA = drizzle({ client: proxyA as unknown as PGlite, schema });
    dbB = drizzle({ client: proxyB as unknown as PGlite, schema });
  });

  afterAll(async () => {
    await Promise.all([proxyA.close(), proxyB.close()]);
    await DatabaseRpcHandler.getInstance().stop();
    await pg.close();
    vi.unstubAllGlobals();
  });

  it('keeps one proxy transaction durable when another proxy rolls back', async () => {
    let releaseProxyA!: () => void;
    const proxyACanCommit = new Promise<void>((resolve) => {
      releaseProxyA = resolve;
    });
    let proxyAInserted!: () => void;
    const proxyAInsertFinished = new Promise<void>((resolve) => {
      proxyAInserted = resolve;
    });

    const transactionA = proxyA.transaction(async (tx) => {
      const inserted = await tx.query<[number, string]>(
        'INSERT INTO transaction_probe (id, value) VALUES ($1, $2) RETURNING id, value',
        [1, 'must-survive'],
      );
      proxyAInserted();
      await proxyACanCommit;
      return inserted.rows;
    });

    await proxyAInsertFinished;
    let proxyBTransactionStarted = false;
    const transactionB = proxyB.transaction(async () => {
      proxyBTransactionStarted = true;
      throw new Error('proxy B aborts only its own transaction');
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(proxyBTransactionStarted).toBe(false);

    releaseProxyA();
    await expect(transactionA).resolves.toEqual([[1, 'must-survive']]);
    await expect(transactionB).rejects.toThrow('proxy B aborts only its own transaction');

    const visible = await proxyB.query<[number, string]>(
      'SELECT id, value FROM transaction_probe ORDER BY id',
    );
    expect(visible.rows).toEqual([[1, 'must-survive']]);
  });

  it('correlates equal request ids independently on different ports', async () => {
    const clientA = createClient();
    const clientB = createClient();
    const sharedRequestId = 7_000_000_000_000_001;
    const responses = Promise.all([
      callRawWithId(clientA, sharedRequestId, {
        op: 'query',
        payload: { sql: 'SELECT 11', rowMode: 'array' },
      }),
      callRawWithId(clientB, sharedRequestId, {
        op: 'query',
        payload: { sql: 'SELECT 22', rowMode: 'array' },
      }),
    ]);

    const settled = await Promise.race([
      responses,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    expect(settled).toEqual([
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ rows: [[11]] }),
      }),
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ rows: [[22]] }),
      }),
    ]);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('queues a foreign normal query until the active transaction commits', async () => {
    let releaseTransaction!: () => void;
    const mayCommit = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let inserted!: () => void;
    const insertFinished = new Promise<void>((resolve) => {
      inserted = resolve;
    });

    const transaction = proxyA.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO transaction_probe (id, value) VALUES ($1, $2)',
        [2, 'visible-after-commit'],
      );
      inserted();
      await mayCommit;
    });
    await insertFinished;

    let observerSettled = false;
    const observerQuery = proxyB
      .query<[number, string]>(
        'SELECT id, value FROM transaction_probe WHERE id = $1',
        [2],
      )
      .then((result) => {
        observerSettled = true;
        return result;
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(observerSettled).toBe(false);

    releaseTransaction();
    await expect(transaction).resolves.toBeUndefined();
    await expect(observerQuery).resolves.toMatchObject({
      rows: [[2, 'visible-after-commit']],
    });
  });

  it('keeps concurrent transactions on one proxy serialized', async () => {
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = proxyA.transaction(async () => {
      firstStarted();
      await firstMayCommit;
      return 'first';
    });
    await firstDidStart;

    let secondStarted = false;
    const second = proxyA.transaction(async () => {
      secondStarted = true;
      return 'second';
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(secondStarted).toBe(false);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
  });

  it('rolls back and releases ownership when the owning port disconnects', async () => {
    const owner = createClient();
    const observer = createClient();

    await expect(
      callRaw(owner, {
        op: 'transaction-begin',
        transactionId: 'disconnected-owner',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      callRaw(owner, {
        op: 'query',
        transactionId: 'disconnected-owner',
        payload: {
          sql: "INSERT INTO transaction_probe (id, value) VALUES (3, 'must-roll-back')",
          rowMode: 'array',
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    let observerSettled = false;
    const observerQuery = callRaw(observer, {
      op: 'query',
      payload: {
        sql: 'SELECT id FROM transaction_probe WHERE id = 3',
        rowMode: 'array',
      },
    }).then((response) => {
      observerSettled = true;
      return response;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(observerSettled).toBe(false);

    owner.disconnect();

    await expect(
      Promise.race([
        observerQuery,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('observer remained blocked')), 250);
        }),
      ]),
    ).resolves.toMatchObject({
      ok: true,
      data: { rows: [] },
    });
    observer.disconnect();
  });

  it('rejects wrong-port and stale transaction identities', async () => {
    const owner = createClient();
    const intruder = createClient();
    const transactionId = 'identity-validation';

    await expect(
      callRaw(owner, { op: 'transaction-begin', transactionId }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      callRaw(intruder, {
        op: 'query',
        transactionId,
        payload: { sql: 'SELECT 1', rowMode: 'array' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('not the active owner'),
    });

    await expect(
      callRaw(owner, { op: 'transaction-rollback', transactionId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      callRaw(owner, { op: 'transaction-begin', transactionId }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Stale transaction identity'),
    });
    await expect(
      callRaw(intruder, {
        op: 'query',
        payload: { sql: 'SELECT 1', rowMode: 'array' },
      }),
    ).resolves.toMatchObject({ ok: true, data: { rows: [[1]] } });

    owner.disconnect();
    intruder.disconnect();
  });

  it('rejects an expired transaction begin without acquiring ownership', async () => {
    const client = createClient();
    const expired = await callRaw(
      client,
      {
        op: 'transaction-begin',
        transactionId: 'expired-transaction',
        deadlineAt: Date.now() - 1,
      } as Omit<RpcRequest, 'id'>,
    );

    if (expired.ok) {
      await callRaw(client, {
        op: 'transaction-rollback',
        transactionId: 'expired-transaction',
      });
    }
    expect(expired).toMatchObject({
      ok: false,
      error: expect.stringContaining('expired'),
    });
    await expect(
      callRaw(client, {
        op: 'query',
        payload: { sql: 'SELECT 1', rowMode: 'array' },
      }),
    ).resolves.toMatchObject({ ok: true, data: { rows: [[1]] } });
    client.disconnect();
  });

  it('releases the owner when its lifecycle deadline is invalid', async () => {
    const owner = createClient();
    const observer = createClient();
    const transactionId = 'invalid-deadline-owner';

    await expect(
      callRaw(owner, { op: 'transaction-begin', transactionId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      callRaw(owner, {
        op: 'transaction-rollback',
        transactionId,
        deadlineAt: Number.NaN,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('invalid deadline'),
    });

    const observerQuery = callRaw(observer, {
      op: 'query',
      payload: { sql: 'SELECT 1', rowMode: 'array' },
    });
    const settled = await Promise.race([
      observerQuery,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    if (settled === null) {
      await callRaw(owner, { op: 'transaction-rollback', transactionId });
    }
    expect(settled).toMatchObject({ ok: true, data: { rows: [[1]] } });

    owner.disconnect();
    observer.disconnect();
  });

  it('makes replaced item chunks visible after commit from another proxy', async () => {
    const [author] = await dbB
      .insert(schema.authors)
      .values({
        platform: 'bookmarks',
        platformAuthorId: 'rpc-chunk-author',
        name: 'RPC Author',
      })
      .returning();
    const [item] = await dbB
      .insert(schema.items)
      .values({
        platform: 'bookmarks',
        platformItemId: 'rpc-chunk-item',
        authorId: author.id,
        title: 'RPC chunk persistence',
        authorName: author.name,
        originalUrl: 'https://example.com/rpc-chunk-item',
        contentState: 'has_content',
      })
      .returning();

    await expect(
      replaceItemChunks(dbA, item.id, [
        { text: 'first durable chunk' },
        { text: 'second durable chunk' },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ chunkIndex: 0, chunkText: 'first durable chunk' }),
      expect.objectContaining({ chunkIndex: 1, chunkText: 'second durable chunk' }),
    ]);

    await expect(
      dbB
        .select({
          chunkIndex: schema.itemChunks.chunkIndex,
          chunkText: schema.itemChunks.chunkText,
        })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id))
        .orderBy(asc(schema.itemChunks.chunkIndex)),
    ).resolves.toEqual([
      { chunkIndex: 0, chunkText: 'first durable chunk' },
      { chunkIndex: 1, chunkText: 'second durable chunk' },
    ]);

    await expect(
      replaceItemChunks(dbA, item.id, [{ text: null as unknown as string }]),
    ).rejects.toThrow();
    await expect(
      dbB
        .select({ chunkText: schema.itemChunks.chunkText })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id))
        .orderBy(asc(schema.itemChunks.chunkIndex)),
    ).resolves.toEqual([
      { chunkText: 'first durable chunk' },
      { chunkText: 'second durable chunk' },
    ]);
  });

  it('rejects a transaction whose commit fails and releases the owner', async () => {
    await expect(
      proxyA.transaction(async (tx) => {
        await tx.query('INSERT INTO deferred_commit_probe (value) VALUES (1), (1)');
        return 'must-not-resolve';
      }),
    ).rejects.toThrow('duplicate key value violates unique constraint');

    await expect(
      proxyB.query<[number]>('SELECT count(*)::int FROM deferred_commit_probe'),
    ).resolves.toMatchObject({ rows: [[0]] });
  });

  it('rolls back on stop and rejects a begin whose port disconnected before readiness', async () => {
    const handler = DatabaseRpcHandler.getInstance();
    const owner = createClient();
    const observer = createClient();
    const transactionId = 'stop-owner';

    await expect(
      callRaw(owner, { op: 'transaction-begin', transactionId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      callRaw(owner, {
        op: 'query',
        transactionId,
        payload: {
          sql: "INSERT INTO transaction_probe (id, value) VALUES (99, 'rollback-on-stop')",
          rowMode: 'array',
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    const queuedObserver = callRaw(observer, {
      op: 'query',
      payload: { sql: 'SELECT 1', rowMode: 'array' },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await handler.stop();
    await expect(queuedObserver).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('stopped'),
    });

    const rowsAfterStop = await pg.query('SELECT id FROM transaction_probe WHERE id = 99');
    if (rowsAfterStop.rows.length > 0) await pg.query('ROLLBACK');
    const stopRolledBack = rowsAfterStop.rows.length === 0;

    handler.startListening(CHANNEL_NAME);
    const disconnected = createClient();
    const lateBegin = callRaw(disconnected, {
      op: 'transaction-begin',
      transactionId: 'disconnected-before-ready',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    disconnected.disconnect();
    handler.setPGlite(pg);

    const lateResponse = await lateBegin;
    if (lateResponse.ok) {
      await callRaw(disconnected, {
        op: 'transaction-rollback',
        transactionId: 'disconnected-before-ready',
      });
    }
    expect(stopRolledBack).toBe(true);
    expect(lateResponse).toMatchObject({
      ok: false,
      error: expect.stringContaining('disconnected'),
    });
    await expect(
      callRaw(createClient(), {
        op: 'query',
        payload: { sql: 'SELECT 1', rowMode: 'array' },
      }),
    ).resolves.toMatchObject({ ok: true, data: { rows: [[1]] } });

    owner.disconnect();
    observer.disconnect();
  });
});
