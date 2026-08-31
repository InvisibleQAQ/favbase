import { DEFAULT_AGENT_BRIDGE_PORT, type JsonObject } from '../../lib/agent-bridge/protocol';
import { parseArgv, requireValue, UsageError, type ParsedArgv } from './args';
import { BridgePortInUseError, type BridgeLogger } from './bridge-server';
import { aliasUsageLine, buildAliasArgs, findAlias, TOOL_ALIASES, USAGE_COLUMN } from './commands';
import {
  ConfigError,
  configPath,
  parsePort,
  parseToken,
  readConfigFile,
  resolveConfig,
  SETUP_HINT,
  writeConfigFile,
  type ConfigEnv,
  type ResolvedConfig,
} from './config';
import { Daemon } from './daemon';
import {
  DaemonError,
  ensureDaemon,
  fetchStatus,
  rpcCall,
  stopDaemon,
} from './daemon-client';
import {
  installSkill,
  parseSkillAgents,
  skillRoot,
  SKILL_AGENTS,
} from './skill-install';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_UNAVAILABLE = 2;
export const EXIT_TOOL = 3;

const DEFAULT_IDLE_MINUTES = 120;
const EXTENSION_HINT =
  'open Chrome with favbase installed and enable Settings > Connections > Agent Bridge with the same port and token; the extension reconnects within 30 seconds';

export interface CliIo {
  env: ConfigEnv;
  /** Absolute path of the executable script, re-run as `daemon run` when spawning. */
  cliPath: string;
  /** Home directory used for personal skill roots; injected so tests never touch the real one. */
  homeDir: string;
  skillContent: string;
  version: string;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Registers the handler that stops a foreground daemon (SIGINT/SIGTERM). */
  onSignal?(handler: () => void): void;
}

class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'CliExit';
  }
}

export function usage(version: string, env: ConfigEnv): string {
  const aliases = TOOL_ALIASES.map(aliasUsageLine).join('\n');
  return `favbase ${version} - read-only access to the favbase browser extension

Usage: favbase <command> [options]

Data commands (stdout is JSON, diagnostics go to stderr):
${aliases}
  ${'tools'.padEnd(USAGE_COLUMN)} list the Knowledge Tools the extension advertises
  ${'call <tool> [--args <json-object>]'.padEnd(USAGE_COLUMN)} call any Knowledge Tool by name

Setup and daemon:
  ${'setup --token <token> [--port <port>] [--no-skill]'.padEnd(USAGE_COLUMN)} pair with the extension, install the skill
  ${`install-skill [--agent ${SKILL_AGENTS.join('|')}|all] [--dir <path>]`.padEnd(USAGE_COLUMN)} install only the skill
  ${'doctor'.padEnd(USAGE_COLUMN)} check config, daemon and extension
  ${'daemon [run|start|stop|restart]'.padEnd(USAGE_COLUMN)} run in foreground, or control the background daemon

Config: FAVBASE_TOKEN / FAVBASE_BRIDGE_PORT, else ${configPath(env)} (default port ${DEFAULT_AGENT_BRIDGE_PORT}).
Exit codes: ${EXIT_OK} ok, ${EXIT_USAGE} usage or config, ${EXIT_UNAVAILABLE} daemon or extension unreachable, ${EXIT_TOOL} Knowledge Tool error.
`;
}

function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function idleMinutes(env: ConfigEnv): number {
  const raw = env.FAVBASE_DAEMON_IDLE_MINUTES?.trim();
  if (!raw) return DEFAULT_IDLE_MINUTES;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new ConfigError('FAVBASE_DAEMON_IDLE_MINUTES must be a non-negative number');
  }
  return minutes;
}

function daemonOptions(io: CliIo) {
  return { cliPath: io.cliPath, env: io.env, log: (line: string) => io.stderr(`${line}\n`) };
}

async function connectedConfig(io: CliIo): Promise<ResolvedConfig> {
  const config = await resolveConfig(io.env);
  await ensureDaemon(config, daemonOptions(io));
  return config;
}

async function runTool(io: CliIo, tool: string, args: JsonObject): Promise<number> {
  const config = await connectedConfig(io);
  const response = await rpcCall(config, tool, args);
  if (response.ok) {
    printJson(io, response.result);
    return EXIT_OK;
  }
  io.stderr(`favbase: ${response.code}: ${response.message}\n`);
  if (response.code === 'extension-unavailable' || response.code === 'extension-disconnected') {
    io.stderr(`favbase: ${EXTENSION_HINT}\n`);
    return EXIT_UNAVAILABLE;
  }
  return EXIT_TOOL;
}

async function runTools(io: CliIo): Promise<number> {
  const config = await connectedConfig(io);
  const status = await fetchStatus(config, true);
  if (!status.extension.connected) {
    io.stderr(`favbase: extension-unavailable: ${EXTENSION_HINT}\n`);
    return EXIT_UNAVAILABLE;
  }
  printJson(io, status.extension.tools);
  return EXIT_OK;
}

async function runCall(io: CliIo, parsed: ParsedArgv): Promise<number> {
  const [tool, ...rest] = parsed.positionals;
  if (!tool || rest.length > 0) throw new UsageError('favbase call expects exactly one <tool>');
  for (const name of Object.keys(parsed.flags)) {
    if (name !== 'args') throw new UsageError(`Unknown option --${name} for favbase call`);
  }
  const rawArgs = requireValue(parsed.flags, 'args');
  let args: JsonObject = {};
  if (rawArgs !== undefined) {
    let value: unknown;
    try {
      value = JSON.parse(rawArgs);
    } catch {
      throw new UsageError('--args must be a JSON object');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UsageError('--args must be a JSON object');
    }
    args = value as JsonObject;
  }
  return runTool(io, tool, args);
}

async function runDoctor(io: CliIo): Promise<number> {
  let config: ResolvedConfig;
  try {
    config = await resolveConfig(io.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    printJson(io, { ok: false, config: { path: configPath(io.env), problem: error.message } });
    return EXIT_USAGE;
  }
  const { spawned } = await ensureDaemon(config, daemonOptions(io));
  const status = await fetchStatus(config, true);
  printJson(io, {
    ok: status.extension.connected,
    config: {
      path: config.configPath,
      port: config.port,
      tokenSource: config.tokenSource,
      portSource: config.portSource,
    },
    daemon: { ...status.daemon, spawned },
    extension: status.extension,
  });
  if (status.extension.connected) return EXIT_OK;
  io.stderr(`favbase: extension-unavailable: ${EXTENSION_HINT}\n`);
  return EXIT_UNAVAILABLE;
}

async function runDaemonForeground(io: CliIo): Promise<number> {
  const config = await resolveConfig(io.env);
  const logger: BridgeLogger = { error: (message) => io.stderr(`${message}\n`) };
  const daemon = new Daemon({
    port: config.port,
    token: config.token,
    version: io.version,
    idleMinutes: idleMinutes(io.env),
    logger,
  });
  try {
    await daemon.start();
  } catch (error) {
    if (error instanceof BridgePortInUseError) {
      throw new CliExit(
        EXIT_USAGE,
        `port ${config.port} is already in use; stop the other favbase daemon (favbase daemon stop) or change both the extension port and favbase setup --port`,
      );
    }
    throw error;
  }
  io.stderr(`[favbase] daemon ${io.version} listening on 127.0.0.1:${config.port} (pid ${process.pid})\n`);
  io.onSignal?.(() => void daemon.close());
  await daemon.whenClosed();
  return EXIT_OK;
}

async function runDaemonCommand(io: CliIo, parsed: ParsedArgv): Promise<number> {
  const [action = 'run', ...rest] = parsed.positionals;
  if (rest.length > 0) throw new UsageError('favbase daemon takes at most one action');
  switch (action) {
    case 'run':
      return runDaemonForeground(io);
    case 'start': {
      const config = await resolveConfig(io.env);
      const result = await ensureDaemon(config, daemonOptions(io));
      printJson(io, { ...result.health, port: config.port, spawned: result.spawned });
      return EXIT_OK;
    }
    case 'stop': {
      const config = await resolveConfig(io.env);
      printJson(io, { port: config.port, daemon: await stopDaemon(config) });
      return EXIT_OK;
    }
    case 'restart': {
      const config = await resolveConfig(io.env);
      await stopDaemon(config);
      const result = await ensureDaemon(config, daemonOptions(io));
      printJson(io, { ...result.health, port: config.port, spawned: result.spawned });
      return EXIT_OK;
    }
    default:
      throw new UsageError(`Unknown daemon action "${action}"; use run, start, stop or restart`);
  }
}

async function runInstallSkill(io: CliIo, parsed: ParsedArgv): Promise<number> {
  if (parsed.positionals.length > 0) {
    throw new UsageError('favbase install-skill takes no positional arguments');
  }
  const agents = parseSkillAgents(requireValue(parsed.flags, 'agent'));
  const dir = requireValue(parsed.flags, 'dir');
  const roots = dir ? [dir] : agents.map((agent) => skillRoot(agent, io.homeDir));
  printJson(io, { installed: await installSkill(io.skillContent, roots) });
  return EXIT_OK;
}

async function runSetup(io: CliIo, parsed: ParsedArgv): Promise<number> {
  if (parsed.positionals.length > 0) throw new UsageError('favbase setup takes no positional arguments');
  const token = parseToken(requireValue(parsed.flags, 'token'), '--token');
  if (!token) throw new UsageError(`favbase setup requires --token; ${SETUP_HINT}`);
  const existing = await readConfigFile(io.env);
  const port = parsePort(requireValue(parsed.flags, 'port'), '--port')
    ?? existing.port
    ?? DEFAULT_AGENT_BRIDGE_PORT;

  const path = await writeConfigFile(io.env, { token, port });
  const skills = parsed.flags['no-skill'] === true
    ? []
    : await installSkill(io.skillContent, SKILL_AGENTS.map((agent) => skillRoot(agent, io.homeDir)));
  printJson(io, { configPath: path, port, skills });
  io.stderr('[favbase] next: run favbase doctor with Chrome open to verify the connection\n');
  return EXIT_OK;
}

async function dispatch(io: CliIo, parsed: ParsedArgv): Promise<number> {
  if (parsed.flags.version === true) {
    io.stdout(`${io.version}\n`);
    return EXIT_OK;
  }
  if (parsed.flags.help === true || parsed.command === null || parsed.command === 'help') {
    io.stdout(usage(io.version, io.env));
    return parsed.command === null && parsed.flags.help !== true ? EXIT_USAGE : EXIT_OK;
  }

  const alias = findAlias(parsed.command);
  if (alias) return runTool(io, alias.tool, buildAliasArgs(alias, parsed.positionals, parsed.flags));

  switch (parsed.command) {
    case 'tools':
      return runTools(io);
    case 'call':
      return runCall(io, parsed);
    case 'doctor':
      return runDoctor(io);
    case 'daemon':
      return runDaemonCommand(io, parsed);
    case 'setup':
      return runSetup(io, parsed);
    case 'install-skill':
      return runInstallSkill(io, parsed);
    default:
      throw new UsageError(`Unknown command "${parsed.command}"`);
  }
}

/** Runs one CLI invocation and returns the process exit code. Never throws. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    return await dispatch(io, parseArgv(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`favbase: ${error.message}\nRun favbase --help for usage.\n`);
      return EXIT_USAGE;
    }
    if (error instanceof ConfigError) {
      io.stderr(`favbase: ${error.message}\n`);
      return EXIT_USAGE;
    }
    if (error instanceof CliExit) {
      io.stderr(`favbase: ${error.message}\n`);
      return error.code;
    }
    if (error instanceof DaemonError) {
      io.stderr(`favbase: ${error.code}: ${error.message}\n`);
      return EXIT_UNAVAILABLE;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`favbase: ${message}\n`);
    return EXIT_UNAVAILABLE;
  }
}
