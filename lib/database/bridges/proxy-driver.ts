import type {
  RpcOp,
  RpcResponse,
  RpcTransport,
  QueryOptions,
  QueryResult,
  QueryPayload,
} from './types';
import { serializeForRpc, deserializeQueryResult } from './serialization';

export interface PGliteLike {
  query<R>(sql: string, params?: unknown[], options?: QueryOptions): Promise<QueryResult<R>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: PGliteLike) => Promise<T>): Promise<T>;
  waitReady: Promise<void>;
  close(): Promise<void>;
}

const RPC_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class PGliteSharedProxy implements PGliteLike {
  private readonly transport: RpcTransport;
  private rid = 0;
  private readonly instanceId: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly unsubscribe: () => void;
  public readonly waitReady: Promise<void>;
  private txLock: Promise<void> = Promise.resolve();
  private releaseTxLock: (() => void) | null = null;

  constructor(transport: RpcTransport) {
    this.transport = transport;
    this.instanceId = Math.floor(Math.random() * 1_000_000) + 1;
    this.unsubscribe = this.transport.subscribe((resp) => this.onResponse(resp));
    this.waitReady = this.healthCheck();
  }

  private async acquireTxLock(): Promise<void> {
    while (this.releaseTxLock) {
      await this.txLock;
    }
    this.txLock = new Promise<void>((resolve) => {
      this.releaseTxLock = resolve;
    });
  }

  private doReleaseTxLock(): void {
    const release = this.releaseTxLock;
    this.releaseTxLock = null;
    release?.();
  }

  private async waitTxIdle(): Promise<void> {
    while (this.releaseTxLock) {
      await this.txLock;
    }
  }

  async query<R>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions,
  ): Promise<QueryResult<R>> {
    await this.waitTxIdle();
    return this.rawQuery<R>(sql, params, options);
  }

  private async rawQuery<R>(
    sql: string,
    params?: unknown[],
    options?: QueryOptions,
    transactionId?: string,
  ): Promise<QueryResult<R>> {
    const payload: QueryPayload = {
      sql,
      params,
      rowMode: options?.rowMode ?? 'array',
    };
    const res = await this.call<{ rows: unknown[]; fields?: { name: string; dataTypeID: number }[]; affectedRows?: number }>(
      'query',
      payload,
      transactionId,
    );
    return deserializeQueryResult<R>(res ?? { rows: [] });
  }

  async exec(sql: string): Promise<void> {
    await this.waitTxIdle();
    await this.call('exec', { sql });
  }

  async transaction<T>(fn: (tx: PGliteLike) => Promise<T>): Promise<T> {
    await this.acquireTxLock();
    try {
      const transactionId = globalThis.crypto.randomUUID();
      try {
        await this.call('transaction-begin', undefined, transactionId);
        const out = await fn(this.createTxClient(transactionId));
        await this.call('transaction-commit', undefined, transactionId);
        return out;
      } catch (err) {
        try {
          await this.call('transaction-rollback', undefined, transactionId);
        } catch { /* swallow rollback error */ }
        throw err;
      }
    } finally {
      this.doReleaseTxLock();
    }
  }

  private createTxClient(transactionId: string): PGliteLike {
    return {
      query: <R>(sql: string, params?: unknown[], options?: QueryOptions) =>
        this.rawQuery<R>(sql, params, options, transactionId),
      exec: async (sql: string) => {
        await this.call('exec', { sql }, transactionId);
      },
      transaction: async <T>(fn: (tx: PGliteLike) => Promise<T>) =>
        fn(this.createTxClient(transactionId)),
      waitReady: Promise.resolve(),
      close: () => Promise.resolve(),
    };
  }

  async close(): Promise<void> {
    await this.call('close').catch(() => {});
    this.unsubscribe();
    for (const [id, waiter] of this.pending) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error('Proxy closed'));
      this.pending.delete(id);
    }
  }

  private async healthCheck(): Promise<void> {
    await this.call('health');
  }

  private call<T>(op: RpcOp, payload?: unknown, transactionId?: string): Promise<T> {
    const id = this.nextId();
    return new Promise<T>((resolve, reject) => {
      const waiter: PendingRequest = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      waiter.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout (${op}, ${RPC_TIMEOUT_MS}ms)`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, waiter);
      this.transport.post({
        id,
        op,
        transactionId,
        deadlineAt: Date.now() + RPC_TIMEOUT_MS,
        payload: serializeForRpc(payload),
      });
    });
  }

  private onResponse(resp: RpcResponse): void {
    const waiter = this.pending.get(resp.id);
    if (!waiter) return;
    this.pending.delete(resp.id);
    if (waiter.timer) clearTimeout(waiter.timer);
    if (resp.ok) {
      waiter.resolve(resp.data);
    } else {
      waiter.reject(new Error(resp.error || 'Unknown RPC error'));
    }
  }

  private nextId(): number {
    this.rid = (this.rid + 1) % 1_000_000_000;
    if (this.rid === 0) this.rid = 1;
    return this.instanceId * 1_000_000_000 + this.rid;
  }
}
