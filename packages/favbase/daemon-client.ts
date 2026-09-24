import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { request } from 'node:http';

import {
  decodeAgentBridgeToolDescriptor,
  type JsonObject,
} from '../../lib/agent-bridge/protocol';
import { LOOPBACK_HOST } from './bridge-server';
import { daemonLogPath, favbaseHome, type ConfigEnv, type ResolvedConfig } from './config';
import {
  DAEMON_NAME,
  RPC_ROUTES,
  type StatusResponse,
  type HealthResponse,
  type RpcResponse,
} from './rpc-server';
import { compareVersions } from './version';

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

function isStatusDaemon(value: unknown): value is StatusResponse['daemon'] {
  if (!isHealth(value)) return false;
  const daemon = value as HealthResponse & Record<string, unknown>;
  return Number.isInteger(daemon.port)
    && Number(daemon.port) >= 0
    && Number(daemon.port) <= 65_535
    && Number.isFinite(daemon.startedAt)
    && Number.isFinite(daemon.idleMinutes)
    && Number(daemon.idleMinutes) >= 0;
}

function foreignPort(port: number): DaemonError {
  return new DaemonError(
    'foreign',
    `127.0.0.1:${port} is served by something that is not the favbase daemon; pick another port in favbase Settings > Connections > Agent Skills and run favbase setup --port <port>`,
  );
}

function hasErrno(error: unknown, ...codes: string[]): boolean {
  return error instanceof DaemonError && error.errno !== undefined && codes.includes(error.errno);
}

/**
 * A daemon that is shutting down resets the connections it had accepted. That
 * is routine once a newer CLI replaces an older daemon (docs/27 D14): parallel
 * commands after an upgrade probe it mid-shutdown. One pause and a second look
 * turns the reset into the real answer -- gone, or the new daemon -- instead
 * of reporting the port as foreign.
 */
async function requestHealth(port: number): Promise<HttpResult> {
  const probe = () => requestJson(port, 'GET', RPC_ROUTES.health, { timeoutMs: HEALTH_TIMEOUT_MS });
  try {
    return await probe();
  } catch (error) {
    if (!hasErrno(error, 'ECONNRESET')) throw error;
    await sleep(SPAWN_POLL_MS);
    return probe();
  }
}

/** `null` when nothing listens on the port; throws `foreign` when something else does. */
export async function fetchHealth(port: number): Promise<HealthResponse | null> {
  let result: HttpResult;
  try {
    result = await requestHealth(port);
  } catch (error) {
    if (hasErrno(error, 'ECONNREFUSED')) return null;
    throw error instanceof DaemonError && error.code === 'unreachable' ? foreignPort(port) : error;
  }
  if (result.status !== 200 || !isHealth(result.body)) throw foreignPort(port);
  return result.body;
}

export interface EnsureDaemonOptions {
  cliPath: string;
  env: ConfigEnv;
  /** This CLI's version; a running daemon older than it is replaced. */
  cliVersion: string;
  log(message: string): void;
}

export interface DaemonReplacement {
  from: string;
  to: string;
}

export interface EnsureDaemonResult {
  health: HealthResponse;
  spawned: boolean;
  /** Set when an older daemon was stopped to make room for this CLI's. */
  replaced: DaemonReplacement | null;
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

/**
 * Stops a daemon that is older than this CLI. Without this an upgraded CLI
 * would keep talking to the old daemon's code indefinitely: a connected
 * extension keeps a daemon from idling out (docs/24). A newer daemon, or one
 * whose version is not a comparable release, is kept -- the newest version
 * wins, so two installed CLIs never take turns restarting it. A failed stop is
 * surfaced, never swallowed: falling back to the old daemon would hide it.
 */
async function replaceOlderDaemon(
  config: ResolvedConfig,
  existing: HealthResponse,
  options: EnsureDaemonOptions,
): Promise<DaemonReplacement> {
  const replaced = { from: existing.version, to: options.cliVersion };
  options.log(
    `[favbase] replacing daemon ${replaced.from} (pid ${existing.pid}) with this CLI's ${replaced.to}`,
  );
  try {
    // Only the daemon found above: a parallel command of this version may
    // already have replaced it, and its fresh daemon must not be stopped.
    await stopDaemon(config, existing.pid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DaemonError(
      error instanceof DaemonError ? error.code : 'unreachable',
      `could not stop the older favbase daemon ${replaced.from} (pid ${existing.pid}) to replace it with ${replaced.to}: ${message}`,
    );
  }
  return replaced;
}

export async function ensureDaemon(
  config: ResolvedConfig,
  options: EnsureDaemonOptions,
): Promise<EnsureDaemonResult> {
  const existing = await fetchHealth(config.port);
  if (existing && compareVersions(existing.version, options.cliVersion) !== -1) {
    return { health: existing, spawned: false, replaced: null };
  }
  const replaced = existing ? await replaceOlderDaemon(config, existing, options) : null;

  const logPath = await spawnDaemon(config, options);
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_MS);
    const health = await fetchHealth(config.port);
    if (health) return { health, spawned: true, replaced };
  }
  throw new DaemonError(
    'spawn-failed',
    `favbase daemon did not answer within ${SPAWN_WAIT_MS / 1000}s; see ${logPath}`,
  );
}

function unauthorized(port: number): DaemonError {
  return new DaemonError(
    'unauthorized',
    `the favbase daemon on port ${port} uses a different pairing token; run favbase daemon restart`,
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

function normalizeStatus(value: unknown): StatusResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok !== true || !isStatusDaemon(candidate.daemon)) return null;
  if (!candidate.extension || typeof candidate.extension !== 'object') return null;

  const extension = candidate.extension as Record<string, unknown>;
  if (typeof extension.connected !== 'boolean'
    || !(typeof extension.extensionId === 'string' || extension.extensionId === null)
    || !Array.isArray(extension.tools)) {
    return null;
  }
  const tools = [];
  for (const input of extension.tools) {
    const tool = decodeAgentBridgeToolDescriptor(input);
    if (!tool) return null;
    tools.push(tool);
  }

  const lastReason = extension.lastRejectedHelloReason;
  const validReason = lastReason === 'bad-token'
    || lastReason === 'bad-origin'
    || lastReason === 'version';
  return {
    ok: true,
    daemon: candidate.daemon,
    extension: {
      connected: extension.connected,
      extensionId: extension.extensionId,
      tools,
      rejectedHelloCount: Number.isSafeInteger(extension.rejectedHelloCount)
        && Number(extension.rejectedHelloCount) >= 0
        ? Number(extension.rejectedHelloCount)
        : 0,
      lastRejectedHelloAt: Number.isSafeInteger(extension.lastRejectedHelloAt)
        && Number(extension.lastRejectedHelloAt) >= 0
        && Number(extension.lastRejectedHelloAt) <= 8_640_000_000_000_000
        ? Number(extension.lastRejectedHelloAt)
        : null,
      lastRejectedHelloReason: validReason ? lastReason : null,
    },
  };
}

export async function fetchStatus(config: ResolvedConfig, wait: boolean): Promise<StatusResponse> {
  const path = wait ? `${RPC_ROUTES.status}?wait=1` : RPC_ROUTES.status;
  const result = await requestJson(config.port, 'GET', path, {
    token: config.token,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (result.status === 401) throw unauthorized(config.port);
  const status = normalizeStatus(result.body);
  if (result.status !== 200 || !status) {
    throw new DaemonError('protocol', `unexpected daemon response (HTTP ${result.status})`);
  }
  return status;
}

/**
 * Asks the daemon to exit; falls back to killing the pid it reported when the
 * token no longer matches. Only a process that identified itself as the
 * favbase daemon over `/health` is ever signalled. With `onlyPid`, a daemon
 * reporting any other pid is left alone and reads as `not-running`: the one
 * the caller meant to stop is gone.
 */
export async function stopDaemon(
  config: ResolvedConfig,
  onlyPid?: number,
): Promise<'stopped' | 'not-running'> {
  const health = await fetchHealth(config.port);
  if (!health || (onlyPid !== undefined && health.pid !== onlyPid)) return 'not-running';

  let result: HttpResult | null = null;
  try {
    result = await requestJson(config.port, 'POST', RPC_ROUTES.shutdown, {
      token: config.token,
      timeoutMs: HEALTH_TIMEOUT_MS,
    });
  } catch (error) {
    // Already on its way out (another CLI's shutdown got there first), so it
    // reset or refused this one. The wait below still tells gone from stuck.
    if (!hasErrno(error, 'ECONNRESET', 'ECONNREFUSED')) throw error;
  }
  if (result?.status === 401) process.kill(health.pid);

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
