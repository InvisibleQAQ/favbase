import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { request } from 'node:http';

import type { JsonObject } from '../../lib/agent-bridge/protocol';
import { LOOPBACK_HOST } from './bridge-server';
import { daemonLogPath, favbaseHome, type ConfigEnv, type ResolvedConfig } from './config';
import {
  DAEMON_NAME,
  RPC_ROUTES,
  type HealthResponse,
  type RpcResponse,
  type StatusResponse,
} from './rpc-server';

const HEALTH_TIMEOUT_MS = 2_000;
const SPAWN_WAIT_MS = 10_000;
const SPAWN_POLL_MS = 100;
const STOP_WAIT_MS = 5_000;
/** Covers either the daemon's hello wait (75s) or one tool call deadline (60s). */
const REQUEST_TIMEOUT_MS = 120_000;

export type DaemonErrorCode =
  | 'unreachable'
  | 'unauthorized'
  | 'foreign'
  | 'spawn-failed'
  | 'protocol';

export class DaemonError extends Error {
  constructor(
    readonly code: DaemonErrorCode,
    message: string,
    readonly errno?: string,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

interface HttpResult {
  status: number;
  body: unknown;
}

interface RequestOptions {
  token?: string;
  body?: unknown;
  timeoutMs: number;
}

function requestJson(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  options: RequestOptions,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    const clientRequest = request(
      { host: LOOPBACK_HOST, port, method, path, headers, timeout: options.timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = null;
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
        response.once('error', (error) => reject(new DaemonError('unreachable', error.message)));
      },
    );
    clientRequest.once('timeout', () => {
      clientRequest.destroy(new Error(`timed out after ${options.timeoutMs}ms`));
    });
    clientRequest.once('error', (error: NodeJS.ErrnoException) => {
      reject(new DaemonError('unreachable', error.message, error.code));
    });
    if (payload !== undefined) clientRequest.write(payload);
    clientRequest.end();
  });
}

function isHealth(value: unknown): value is HealthResponse {
  return !!value
    && typeof value === 'object'
    && (value as HealthResponse).name === DAEMON_NAME
    && typeof (value as HealthResponse).version === 'string'
    && typeof (value as HealthResponse).pid === 'number';
}

function foreignPort(port: number): DaemonError {
  return new DaemonError(
    'foreign',
    `127.0.0.1:${port} is served by something that is not the favbase daemon; pick another port in favbase Settings > Connections > Agent Bridge and run favbase setup --port <port>`,
  );
}

/** `null` when nothing listens on the port; throws `foreign` when something else does. */
export async function fetchHealth(port: number): Promise<HealthResponse | null> {
  let result: HttpResult;
  try {
    result = await requestJson(port, 'GET', RPC_ROUTES.health, { timeoutMs: HEALTH_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof DaemonError && error.errno === 'ECONNREFUSED') return null;
    throw error instanceof DaemonError && error.code === 'unreachable' ? foreignPort(port) : error;
  }
  if (result.status !== 200 || !isHealth(result.body)) throw foreignPort(port);
  return result.body;
}

export interface EnsureDaemonOptions {
  cliPath: string;
  env: ConfigEnv;
  log(message: string): void;
}

async function spawnDaemon(config: ResolvedConfig, options: EnsureDaemonOptions): Promise<string> {
  const home = favbaseHome(options.env);
  await mkdir(home, { recursive: true });
  const logPath = daemonLogPath(options.env);
  const logFd = openSync(logPath, 'a');
  try {
    const child = spawn(process.execPath, [options.cliPath, 'daemon', 'run'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: {
        ...options.env,
        FAVBASE_TOKEN: config.token,
        FAVBASE_BRIDGE_PORT: String(config.port),
        FAVBASE_HOME: home,
      },
    });
    child.unref();
    options.log(
      `[favbase] starting daemon on ${LOOPBACK_HOST}:${config.port} (pid ${child.pid ?? '?'}, log ${logPath})`,
    );
  } finally {
    closeSync(logFd);
  }
  return logPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureDaemon(
  config: ResolvedConfig,
  options: EnsureDaemonOptions,
): Promise<{ health: HealthResponse; spawned: boolean }> {
  const existing = await fetchHealth(config.port);
  if (existing) return { health: existing, spawned: false };

  const logPath = await spawnDaemon(config, options);
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_MS);
    const health = await fetchHealth(config.port);
    if (health) return { health, spawned: true };
  }
  throw new DaemonError(
    'spawn-failed',
    `favbase daemon did not answer within ${SPAWN_WAIT_MS / 1000}s; see ${logPath}`,
  );
}

function unauthorized(port: number): DaemonError {
  return new DaemonError(
    'unauthorized',
    `the favbase daemon on port ${port} uses a different Bridge Token; run favbase daemon restart`,
  );
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; code?: unknown; message?: unknown };
  if (candidate.ok === true) return 'result' in candidate;
  return candidate.ok === false
    && typeof candidate.code === 'string'
    && typeof candidate.message === 'string';
}

export async function rpcCall(
  config: ResolvedConfig,
  tool: string,
  args: JsonObject,
): Promise<RpcResponse> {
  const result = await requestJson(config.port, 'POST', RPC_ROUTES.rpc, {
    token: config.token,
    body: { tool, args },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (result.status === 401) throw unauthorized(config.port);
  if (result.status !== 200 || !isRpcResponse(result.body)) {
    throw new DaemonError('protocol', `unexpected daemon response (HTTP ${result.status})`);
  }
  return result.body;
}

function isStatus(value: unknown): value is StatusResponse {
  return !!value
    && typeof value === 'object'
    && (value as StatusResponse).ok === true
    && isHealth((value as StatusResponse).daemon)
    && typeof (value as StatusResponse).extension === 'object';
}

export async function fetchStatus(config: ResolvedConfig, wait: boolean): Promise<StatusResponse> {
  const path = wait ? `${RPC_ROUTES.status}?wait=1` : RPC_ROUTES.status;
  const result = await requestJson(config.port, 'GET', path, {
    token: config.token,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (result.status === 401) throw unauthorized(config.port);
  if (result.status !== 200 || !isStatus(result.body)) {
    throw new DaemonError('protocol', `unexpected daemon response (HTTP ${result.status})`);
  }
  return result.body;
}

/**
 * Asks the daemon to exit; falls back to killing the pid it reported when the
 * token no longer matches. Only a process that identified itself as the
 * favbase daemon over `/health` is ever signalled.
 */
export async function stopDaemon(config: ResolvedConfig): Promise<'stopped' | 'not-running'> {
  const health = await fetchHealth(config.port);
  if (!health) return 'not-running';

  const result = await requestJson(config.port, 'POST', RPC_ROUTES.shutdown, {
    token: config.token,
    timeoutMs: HEALTH_TIMEOUT_MS,
  });
  if (result.status === 401) process.kill(health.pid);

  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_MS);
    if ((await fetchHealth(config.port)) === null) return 'stopped';
  }
  throw new DaemonError(
    'unreachable',
    `favbase daemon (pid ${health.pid}) did not exit within ${STOP_WAIT_MS / 1000}s`,
  );
}
