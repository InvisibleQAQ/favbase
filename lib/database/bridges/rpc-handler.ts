import type { PGlite } from '@electric-sql/pglite';
import type { RpcRequest, RpcResponse, QueryPayload, ExecPayload } from './types';
import { serializeForRpc, deserializeFromRpc } from './serialization';

interface TransactionOwner {
  id: string;
  port: chrome.runtime.Port;
}

interface ScheduledRequest {
  request: RpcRequest;
  payload: unknown;
  port: chrome.runtime.Port;
  generation: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_FINISHED_TRANSACTION_IDS = 1_024;

export class DatabaseRpcHandler {
  private static instance: DatabaseRpcHandler | null = null;
  private pglite: PGlite | null = null;
  private listening = false;
  private listenerRegistered = false;
  private inFlightByPort = new WeakMap<chrome.runtime.Port, Set<number>>();
  private readonly scheduledRequests: ScheduledRequest[] = [];
  private transactionOwner: TransactionOwner | null = null;
  private drainingRequests = false;
  private disconnectedPorts = new WeakSet<chrome.runtime.Port>();
  private readonly finishedTransactionIds = new Set<string>();
  private readonly finishedTransactionOrder: string[] = [];
  private generation = 0;
  private pgliteReady!: Promise<void>;
  private resolvePgliteReady!: () => void;
  private rejectPgliteReady!: (err: Error) => void;

  private constructor() {
    this.resetReadyGate();
  }

  static getInstance(): DatabaseRpcHandler {
    if (!DatabaseRpcHandler.instance) {
      DatabaseRpcHandler.instance = new DatabaseRpcHandler();
    }
    return DatabaseRpcHandler.instance;
  }

  startListening(channelName: string): void {
    if (this.listening) return;
    this.listening = true;
    if (this.listenerRegistered) return;
    this.listenerRegistered = true;

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== channelName) return;
      port.onMessage.addListener((raw: unknown) => {
        const req = raw as RpcRequest;
        if (typeof req?.id !== 'number' || typeof req?.op !== 'string') return;
        this.handleMessage(req, port);
      });
      port.onDisconnect.addListener(() => this.handleDisconnect(port));
    });
  }

  setPGlite(pg: PGlite): void {
    this.pglite = pg;
    this.resolvePgliteReady();
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.generation += 1;
    const pg = this.pglite;
    const owner = this.transactionOwner;
    this.pglite = null;
    this.inFlightByPort = new WeakMap<chrome.runtime.Port, Set<number>>();
    this.transactionOwner = null;
    this.disconnectedPorts = new WeakSet<chrome.runtime.Port>();
    for (const scheduled of this.scheduledRequests.splice(0)) {
      scheduled.reject(new Error('DatabaseRpcHandler stopped'));
    }
    this.finishedTransactionIds.clear();
    this.finishedTransactionOrder.length = 0;
    this.rejectPgliteReady(new Error('DatabaseRpcHandler stopped'));
    this.resetReadyGate();

    if (owner && pg) {
      try {
        await pg.query('ROLLBACK');
      } catch { /* shutdown still completes if rollback cannot be delivered */ }
    }
  }

  private resetReadyGate(): void {
    this.pgliteReady = new Promise<void>((resolve, reject) => {
      this.resolvePgliteReady = resolve;
      this.rejectPgliteReady = reject;
    });
    this.pgliteReady.catch(() => {}); // prevent unhandled rejection from stop()
  }

  private async handleMessage(
    req: RpcRequest,
    port: chrome.runtime.Port,
  ): Promise<void> {
    if (!this.listening) return;
    const generation = this.generation;
    const inFlight = this.getInFlightRequests(port);
    if (inFlight.has(req.id)) return;
    inFlight.add(req.id);

    try {
      await this.pgliteReady;
      this.assertRequestContext(port, generation);

      const payload = deserializeFromRpc(req.payload);
      const result = await this.scheduleRequest(req, payload, port, generation);
      this.assertRequestContext(port, generation);

      const response: RpcResponse = {
        id: req.id,
        ok: true,
        data: serializeForRpc(result),
      };
      this.sendSafe(port, response);
    } catch (err) {
      const response: RpcResponse = {
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.sendSafe(port, response);
    } finally {
      inFlight.delete(req.id);
    }
  }

  private getInFlightRequests(port: chrome.runtime.Port): Set<number> {
    const existing = this.inFlightByPort.get(port);
    if (existing) return existing;

    const created = new Set<number>();
    this.inFlightByPort.set(port, created);
    return created;
  }

  private sendSafe(port: chrome.runtime.Port, msg: RpcResponse): void {
    try {
      port.postMessage(msg);
    } catch { /* port disconnected, caller will timeout and retry */ }
  }

  private scheduleRequest(
    request: RpcRequest,
    payload: unknown,
    port: chrome.runtime.Port,
    generation = this.generation,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.scheduledRequests.push({ request, payload, port, generation, resolve, reject });
      this.drainRequests();
    });
  }

  private drainRequests(): void {
    if (this.drainingRequests) return;
    this.drainingRequests = true;
    void this.runDrainLoop();
  }

  private async runDrainLoop(): Promise<void> {
    try {
      let next = this.takeNextRunnableRequest();
      while (next) {
        await this.settleScheduledRequest(next);
        next = this.takeNextRunnableRequest();
      }
    } finally {
      this.drainingRequests = false;
      if (this.takeNextRunnableIndex() >= 0) this.drainRequests();
    }
  }

  private takeNextRunnableRequest(): ScheduledRequest | null {
    const index = this.takeNextRunnableIndex();
    if (index < 0) return null;
    return this.scheduledRequests.splice(index, 1)[0];
  }

  private takeNextRunnableIndex(): number {
    return this.scheduledRequests.findIndex((scheduled) => this.canRun(scheduled));
  }

  private async settleScheduledRequest(scheduled: ScheduledRequest): Promise<void> {
    try {
      scheduled.resolve(await this.dispatch(scheduled));
    } catch (err) {
      scheduled.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private canRun({ request, port }: ScheduledRequest): boolean {
    if (!this.transactionOwner) return true;

    switch (request.op) {
      case 'health':
      case 'close':
      case 'transaction-commit':
      case 'transaction-rollback':
        return true;
      case 'transaction-begin':
        if (!this.isValidTransactionId(request.transactionId)) return true;
        return (
          this.finishedTransactionIds.has(request.transactionId) ||
          this.isTransactionOwner(request, port)
        );
      case 'query':
      case 'exec':
        // Tagged requests run immediately: the active owner proceeds while a
        // wrong identity reaches validation and rejects without touching PGlite.
        return request.transactionId !== undefined;
      default:
        return true;
    }
  }

  private async dispatch(
    { request, payload, port, generation }: ScheduledRequest,
  ): Promise<unknown> {
    if (request.op !== 'close') this.assertRequestContext(port, generation);
    await this.rejectExpiredRequest(request, port);

    switch (request.op) {
      case 'health':
        return { status: 'ok' };

      case 'query': {
        this.assertDatabaseAccess(request, port);
        const q = payload as QueryPayload;
        const res = await this.pglite!.query(q.sql, q.params, {
          rowMode: q.rowMode,
        });
        return {
          rows: res.rows,
          fields: res.fields,
          affectedRows: res.affectedRows,
        };
      }

      case 'exec': {
        this.assertDatabaseAccess(request, port);
        const e = payload as ExecPayload;
        await this.pglite!.exec(e.sql);
        return null;
      }

      case 'transaction-begin':
        return this.beginTransaction(request, port, generation);

      case 'transaction-commit':
        return this.finishTransaction(request, port, 'COMMIT');

      case 'transaction-rollback':
        return this.finishTransaction(request, port, 'ROLLBACK');

      case 'close':
        return this.closePort(port);

      default:
        throw new Error(`Unsupported database RPC operation: ${String(request.op)}`);
    }
  }

  private async beginTransaction(
    request: RpcRequest,
    port: chrome.runtime.Port,
    generation: number,
  ): Promise<null> {
    const transactionId = this.readTransactionId(request);
    if (this.finishedTransactionIds.has(transactionId)) {
      throw new Error(`Stale transaction identity: ${transactionId}`);
    }
    if (this.transactionOwner) {
      throw new Error('Another database transaction is already active');
    }

    const pg = this.pglite!;
    await pg.query('BEGIN');
    try {
      this.assertRequestContext(port, generation);
    } catch (error) {
      try {
        await pg.query('ROLLBACK');
      } catch { /* preserve the lifecycle error */ }
      throw error;
    }
    this.transactionOwner = { id: transactionId, port };
    return null;
  }

  private async finishTransaction(
    request: RpcRequest,
    port: chrome.runtime.Port,
    operation: 'COMMIT' | 'ROLLBACK',
  ): Promise<null> {
    const owner = this.assertTransactionOwner(request, port);
    try {
      await this.pglite!.query(operation);
    } catch (err) {
      if (operation === 'COMMIT') {
        try {
          await this.pglite!.query('ROLLBACK');
        } catch { /* preserve the commit error */ }
      }
      throw err;
    } finally {
      if (this.transactionOwner === owner) {
        this.transactionOwner = null;
        this.rememberFinishedTransaction(owner.id);
      }
    }
    return null;
  }

  private async closePort(port: chrome.runtime.Port): Promise<null> {
    const owner = this.transactionOwner;
    if (!owner || owner.port !== port) return null;

    try {
      await this.pglite!.query('ROLLBACK');
    } finally {
      if (this.transactionOwner === owner) {
        this.transactionOwner = null;
        this.rememberFinishedTransaction(owner.id);
      }
    }
    return null;
  }

  private async rejectExpiredRequest(
    request: RpcRequest,
    port: chrome.runtime.Port,
  ): Promise<void> {
    if (request.deadlineAt === undefined) return;
    const error = Number.isFinite(request.deadlineAt)
      ? new Error(`Database RPC request expired before execution: ${request.op}`)
      : new Error('Database RPC request has an invalid deadline');
    if (Number.isFinite(request.deadlineAt) && Date.now() < request.deadlineAt) return;

    const isLifecycleFinish =
      request.op === 'transaction-commit' || request.op === 'transaction-rollback';
    if (isLifecycleFinish && this.isTransactionOwner(request, port)) {
      try {
        await this.finishTransaction(request, port, 'ROLLBACK');
      } catch { /* preserve the deadline error while finishTransaction releases ownership */ }
    }
    throw error;
  }

  private handleDisconnect(port: chrome.runtime.Port): void {
    if (this.disconnectedPorts.has(port)) return;
    this.disconnectedPorts.add(port);

    for (let i = this.scheduledRequests.length - 1; i >= 0; i -= 1) {
      const scheduled = this.scheduledRequests[i];
      if (scheduled.port !== port) continue;
      this.scheduledRequests.splice(i, 1);
      scheduled.reject(new Error('Database RPC port disconnected'));
    }

    void this.scheduleRequest(
      { id: Number.MIN_SAFE_INTEGER, op: 'close' },
      undefined,
      port,
    ).catch(() => {});
  }

  private assertDatabaseAccess(request: RpcRequest, port: chrome.runtime.Port): void {
    if (request.transactionId === undefined) {
      if (this.transactionOwner) {
        throw new Error('Normal database request entered an active transaction');
      }
      return;
    }
    this.assertTransactionOwner(request, port);
  }

  private assertRequestContext(port: chrome.runtime.Port, generation: number): void {
    if (!this.listening || generation !== this.generation) {
      throw new Error('DatabaseRpcHandler stopped');
    }
    if (this.disconnectedPorts.has(port)) {
      throw new Error('Database RPC port disconnected');
    }
  }

  private assertTransactionOwner(
    request: RpcRequest,
    port: chrome.runtime.Port,
  ): TransactionOwner {
    const transactionId = this.readTransactionId(request);
    const owner = this.transactionOwner;
    if (!owner || owner.id !== transactionId || owner.port !== port) {
      throw new Error(`Transaction identity is not the active owner: ${transactionId}`);
    }
    return owner;
  }

  private isTransactionOwner(request: RpcRequest, port: chrome.runtime.Port): boolean {
    const owner = this.transactionOwner;
    return (
      owner !== null &&
      owner.id === request.transactionId &&
      owner.port === port
    );
  }

  private readTransactionId(request: RpcRequest): string {
    if (!this.isValidTransactionId(request.transactionId)) {
      throw new Error('A valid transaction identity is required');
    }
    return request.transactionId;
  }

  private isValidTransactionId(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_TRANSACTION_ID_LENGTH
    );
  }

  private rememberFinishedTransaction(transactionId: string): void {
    this.finishedTransactionIds.add(transactionId);
    this.finishedTransactionOrder.push(transactionId);
    if (this.finishedTransactionOrder.length <= MAX_FINISHED_TRANSACTION_IDS) return;

    const oldest = this.finishedTransactionOrder.shift();
    if (oldest) this.finishedTransactionIds.delete(oldest);
  }
}
