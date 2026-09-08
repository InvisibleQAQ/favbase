import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_AGENT_BRIDGE_PORT } from '../../lib/agent-bridge/protocol';

export const CONFIG_FILE_NAME = 'config.json';
export const DAEMON_LOG_FILE_NAME = 'daemon.log';
const MAX_TOKEN_LENGTH = 512;

export type ConfigEnv = Readonly<Record<string, string | undefined>>;

export interface ConfigFile {
  token?: string;
  port?: number;
}

export interface ResolvedConfig {
  token: string;
  port: number;
  tokenSource: 'env' | 'file';
  portSource: 'env' | 'file' | 'default';
  configPath: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const SETUP_HINT =
  'copy the Bridge Token from favbase Settings > Connections > Agent Bridge and run: favbase setup --token <token> [--port <port>]';

/** Root for the config file and daemon log; `FAVBASE_HOME` overrides `~/.favbase`. */
export function favbaseHome(env: ConfigEnv = process.env): string {
  const override = env.FAVBASE_HOME?.trim();
  return override ? override : join(homedir(), '.favbase');
}

export function configPath(env: ConfigEnv = process.env): string {
  return join(favbaseHome(env), CONFIG_FILE_NAME);
}

export function daemonLogPath(env: ConfigEnv = process.env): string {
  return join(favbaseHome(env), DAEMON_LOG_FILE_NAME);
}

export function parseToken(value: unknown, source: string): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (!token) return null;
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new ConfigError(`${source} must be at most ${MAX_TOKEN_LENGTH} characters`);
  }
  return token;
}

export function parsePort(value: unknown, source: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const port = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`${source} must be an integer between 1 and 65535`);
  }
  return port;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function readConfigFile(env: ConfigEnv = process.env): Promise<ConfigFile> {
  const path = configPath(env);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return {};
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Cannot read ${path}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${path} is not valid JSON; run favbase setup again`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${path} must contain a JSON object; run favbase setup again`);
  }

  const { token, port } = parsed as Record<string, unknown>;
  const file: ConfigFile = {};
  const parsedToken = parseToken(token, `${path} token`);
  if (parsedToken) file.token = parsedToken;
  const parsedPort = parsePort(port, `${path} port`);
  if (parsedPort !== null) file.port = parsedPort;
  return file;
}

export async function writeConfigFile(
  env: ConfigEnv,
  config: { token: string; port: number },
): Promise<string> {
  const path = configPath(env);
  await mkdir(favbaseHome(env), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return path;
}

/** Precedence: environment, then config file, then the shared default port. */
export async function resolveConfig(env: ConfigEnv = process.env): Promise<ResolvedConfig> {
  const file = await readConfigFile(env);
  const envToken = parseToken(env.FAVBASE_TOKEN, 'FAVBASE_TOKEN');
  const envPort = parsePort(env.FAVBASE_BRIDGE_PORT, 'FAVBASE_BRIDGE_PORT');

  const token = envToken ?? file.token;
  if (!token) throw new ConfigError(`No Bridge Token configured; ${SETUP_HINT}`);

  const port = envPort ?? file.port ?? DEFAULT_AGENT_BRIDGE_PORT;
  return {
    token,
    port,
    tokenSource: envToken ? 'env' : 'file',
    portSource: envPort !== null ? 'env' : file.port !== undefined ? 'file' : 'default',
    configPath: configPath(env),
  };
}
