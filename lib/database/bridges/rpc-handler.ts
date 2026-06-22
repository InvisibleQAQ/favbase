import type { PGlite } from '@electric-sql/pglite';
import type { RpcRequest, RpcResponse, QueryPayload, ExecPayload } from './types';
import { serializeForRpc, deserializeFromRpc } from './serialization';

export class DatabaseRpcHandler {
  private static instance: DatabaseRpcHandler | null = null;
  private pglite: PGlite | null = null;
  private listening = false;
  private readonly inFlight = new Set<number>();

  static getInstance(): DatabaseRpcHandler {
    if (!DatabaseRpcHandler.instance) {
      DatabaseRpcHandler.instance = new DatabaseRpcHandler();
    }
    return DatabaseRpcHandler.instance;
  }

  startListening(channelName: string, pglite: PGlite): void {
    if (this.listening) return;
    this.pglite = pglite;
    this.listening = true;

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== channelName) return;
      port.onMessage.addListener((raw: unknown) => {
        const req = raw as RpcRequest;
        if (typeof req?.id !== 'number' || typeof req?.op !== 'string') return;
        this.handleMessage(req, port);
      });
    });
  }

  stop(): void {
    this.listening = false;
    this.pglite = null;
    this.inFlight.clear();
  }

  private async handleMessage(
    req: RpcRequest,
    port: chrome.runtime.Port,
  ): Promise<void> {
    if (!this.listening || !this.pglite) return;
    if (this.inFlight.has(req.id)) return;
    this.inFlight.add(req.id);

    try {
      const payload = deserializeFromRpc(req.payload);
      let result: unknown = null;

      switch (req.op) {
        case 'health':
          result = { status: 'ok' };
          break;

        case 'query': {
          const q = payload as QueryPayload;
          const res = await this.pglite!.query(q.sql, q.params, {
            rowMode: q.rowMode,
          });
          result = {
            rows: res.rows,
            fields: res.fields,
            affectedRows: res.affectedRows,
          };
          break;
        }

        case 'exec': {
          const e = payload as ExecPayload;
          await this.pglite!.exec(e.sql);
          break;
        }

        case 'close':
          break;
      }

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
      this.inFlight.delete(req.id);
    }
  }

  private sendSafe(port: chrome.runtime.Port, msg: RpcResponse): void {
    try {
      port.postMessage(msg);
    } catch { /* port disconnected, caller will timeout and retry */ }
  }
}
