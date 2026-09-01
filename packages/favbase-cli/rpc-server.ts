import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AgentBridgeToolDescriptor,
  JsonObject,
  JsonValue,
} from '../../lib/agent-bridge/protocol';
import {
  BridgeCallError,
  tokensMatch,
  type BridgePeerSnapshot,
} from './bridge-server';

export const DAEMON_NAME = 'favbase-cli';

export const RPC_ROUTES = Object.freeze({
  health: '/health',
  status: '/status',
  rpc: '/rpc',
  shutdown: '/shutdown',
});

const MAX_BODY_BYTES = 1_048_576;

export interface RpcPeer {
  callTool(name: string, args: JsonObject, signal?: AbortSignal): Promise<JsonValue>;
  listTools(signal?: AbortSignal): Promise<readonly AgentBridgeToolDescriptor[]>;
  peerSnapshot(): BridgePeerSnapshot;
}

export interface HealthResponse {
  name: typeof DAEMON_NAME;
  version: string;
  pid: number;
}

export interface StatusResponse {
  ok: true;
  daemon: HealthResponse & { port: number; startedAt: number; idleMinutes: number };
  extension: BridgePeerSnapshot;
}

export type RpcResponse =
  | { ok: true; result: JsonValue }
  | { ok: false; code: string; message: string };

export interface RpcHandlerOptions {
  token: string;
  version: string;
  port: number;
  startedAt: number;
  idleMinutes: number;
  peer: RpcPeer;
  /** Called on every authenticated CLI request; drives the idle timer. */
  onActivity(): void;
  onShutdown(): void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'payload-too-large', `Request body exceeds ${MAX_BODY_BYTES} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function parseCallBody(raw: string): { tool: string; args: JsonObject } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad-request', 'Request body must be JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'bad-request', 'Request body must be a JSON object');
  }
  const { tool, args } = parsed as Record<string, unknown>;
  if (typeof tool !== 'string' || tool.length === 0) {
    throw new HttpError(400, 'bad-request', '`tool` must be a non-empty string');
  }
  if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
    throw new HttpError(400, 'bad-request', '`args` must be a JSON object when present');
  }
  return { tool, args: (args as JsonObject | undefined) ?? {} };
}

function abortSignalFor(response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function createRpcHandler(
  options: RpcHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const health = (): HealthResponse => ({
    name: DAEMON_NAME,
    version: options.version,
    pid: process.pid,
  });

  const authenticate = (request: IncomingMessage): void => {
    const token = bearerToken(request);
    if (!token || !tokensMatch(token, options.token)) {
      throw new HttpError(401, 'unauthorized', 'Bridge Token missing or does not match this daemon');
    }
    options.onActivity();
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // Browsers always attach Origin to cross-site requests; the CLI never does.
    // Rejecting it closes the "web page fetches 127.0.0.1" path before any auth.
    if (request.headers.origin !== undefined) {
      throw new HttpError(403, 'forbidden', 'Browser requests are not accepted');
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';

    if (url.pathname === RPC_ROUTES.health) {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'Use GET');
      sendJson(response, 200, health());
      return;
    }

    if (url.pathname === RPC_ROUTES.status) {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'Use GET');
      authenticate(request);
      const snapshot = options.peer.peerSnapshot();
      const knownTokenMismatch = !snapshot.connected
        && snapshot.lastRejectedHelloReason === 'bad-token';
      if (url.searchParams.get('wait') === '1' && !knownTokenMismatch) {
        try {
          await options.peer.listTools(abortSignalFor(response));
        } catch (error) {
          if (!(error instanceof BridgeCallError)) throw error;
          // Snapshot below reports `connected: false`; the caller decides.
        }
      }
      const body: StatusResponse = {
        ok: true,
        daemon: {
          ...health(),
          port: options.port,
          startedAt: options.startedAt,
          idleMinutes: options.idleMinutes,
        },
        extension: options.peer.peerSnapshot(),
      };
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === RPC_ROUTES.rpc) {
      if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'Use POST');
      authenticate(request);
      const { tool, args } = parseCallBody(await readBody(request));
      let body: RpcResponse;
      try {
        body = { ok: true, result: await options.peer.callTool(tool, args, abortSignalFor(response)) };
      } catch (error) {
        if (!(error instanceof BridgeCallError)) throw error;
        body = { ok: false, code: error.code, message: error.message };
      }
      sendJson(response, 200, body);
      return;
    }

    if (url.pathname === RPC_ROUTES.shutdown) {
      if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'Use POST');
      authenticate(request);
      sendJson(response, 200, { ok: true });
      setImmediate(() => options.onShutdown());
      return;
    }

    throw new HttpError(404, 'not-found', `No route ${method} ${url.pathname}`);
  };

  return (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        if (error.status === 401) response.setHeader('www-authenticate', 'Bearer');
        sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { ok: false, code: 'internal', message });
    });
  };
}
