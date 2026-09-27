import { readFileSync } from 'node:fs';

import { DEFAULT_AGENT_BRIDGE_PORT, type JsonObject } from '../../lib/agent-bridge/protocol';
import { parseArgv, requireValue, UsageError, type ParsedArgv } from './args';
import type { BridgeLogger } from './bridge-server';
import { aliasUsageLine, buildAliasArgs, findAlias, TOOL_ALIASES, USAGE_COLUMN } from './commands';
import {
  configPath,
  daemonIdleMinutes,
  LocalFileError,
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
  adoptSetupToken,
  ensureDaemon,
  fetchStatus,
  rpcCall,
  stopDaemon,
} from './daemon-client';
import { assembleDoctorReport, NOT_CONNECTED, probeDoctor } from './doctor';
import {
  describeError,
  describeToolError,
  EXIT_CODES,
  EXIT_OK,
  EXIT_USAGE,
  type Failure,
} from './exit-codes';
import {
  canonicalSkillContent,
  installAgentSkills,
  installSkill,
  parseSkillAgents,
  SKILL_AGENTS,
  type SkillAgent,
} from './skill-install';
import {
  checkCliCurrency,
  updateNotice,
  type CliCurrency,
  type UpdatePolicy,
} from './update-check';

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
  /**
   * Latest published CLI version, `null` when no registry answered; never
   * throws. Only cli.ts wires the real one. Without it no command goes online,
   * which is what keeps every test off the network.
   */
  fetchLatestVersion?(): Promise<string | null>;
}

export function usage(version: string, env: ConfigEnv): string {
  const aliases = TOOL_ALIASES.map(aliasUsageLine).join('\n');
  return `favbase ${version} - read-only access to the favbase browser extension

Usage: favbase <command> [options]

Data commands (stdout is JSON, diagnostics go to stderr):
${aliases}
  ${'tools'.padEnd(USAGE_COLUMN)} list the Knowledge Tools the extension advertises
  ${'call <tool> [--args <json-object> | --args-file <path>]'.padEnd(USAGE_COLUMN)} call any Knowledge Tool by name

Setup and daemon:
  ${'setup --token <token> [--port <port>] [--no-skill]'.padEnd(USAGE_COLUMN)} pair with the extension, install the skill
  ${`install-skill [--agent <${SKILL_AGENTS.join(',')}>|all] [--dir <path>]`.padEnd(USAGE_COLUMN)} install only the skill (one agent, or a comma list)
  ${'doctor'.padEnd(USAGE_COLUMN)} check config, daemon, extension, and whether CLI and skill are current
  ${'daemon [run|start|stop|restart]'.padEnd(USAGE_COLUMN)} run in foreground, or control the background daemon

Config: FAVBASE_TOKEN / FAVBASE_BRIDGE_PORT, else ${configPath(env)} (default port ${DEFAULT_AGENT_BRIDGE_PORT}).
Exit codes: ${EXIT_CODES.map(([code, meaning]) => `${code} ${meaning}`).join(', ')}.
`;
}

function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Prints a classified failure and returns its exit code. */
function printFailure(io: CliIo, failure: Failure): number {
  for (const line of failure.lines) io.stderr(`${line}\n`);
  return failure.exitCode;
}

export function formatDaemonLogLine(message: string, at = Date.now()): string {
  return `[${new Date(at).toISOString()}] ${message}`;
}

function daemonOptions(io: CliIo) {
  return {
    cliPath: io.cliPath,
    env: io.env,
    cliVersion: io.version,
    log: (line: string) => io.stderr(`${line}\n`),
  };
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
  return printFailure(io, describeToolError(response.code, response.message));
}

async function runTools(io: CliIo): Promise<number> {
  const config = await connectedConfig(io);
  const status = await fetchStatus(config, true);
  if (!status.extension.connected) {
    return printFailure(io, describeToolError('extension-unavailable', NOT_CONNECTED));
  }
  printJson(io, status.extension.tools);
  return EXIT_OK;
}

function parseJsonObject(text: string, problem: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError(problem);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(problem);
  return value as JsonObject;
}

/**
 * Strict UTF-8, relative to the working directory. The decoder drops the one
 * BOM that Windows PowerShell 5.1's `-Encoding utf8` writes. `fatal` refuses
 * what it writes by default: UTF-16 from `>`/`Out-File`, and from `Set-Content`
 * the ANSI code page -- GBK for non-ASCII text on a code page 936 system, which
 * a lenient read turns into U+FFFD noise that still parses as JSON.
 */
function readArgsFile(path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`cannot read --args-file ${path}: ${reason}`);
  }
}

/**
 * Windows PowerShell 5.1 does not escape embedded `"` when it builds a native
 * command line, so an inline `--args` object arrives without its quotes; a
 * path survives every shell. The file is read here, in the parse phase, so a
 * bad one never starts the daemon or the update check.
 */
function callArgs(flags: ParsedArgv['flags']): JsonObject {
  const inline = requireValue(flags, 'args');
  const file = requireValue(flags, 'args-file');
  if (inline !== undefined && file !== undefined) {
    throw new UsageError('favbase call takes --args or --args-file, not both');
  }
  if (file !== undefined) {
    return parseJsonObject(readArgsFile(file), '--args-file must contain a JSON object');
  }
  if (inline === undefined) return {};
  return parseJsonObject(
    inline,
    '--args must be a JSON object; Windows PowerShell 5.1 strips its double quotes, so write the JSON to a file and pass --args-file <path>',
  );
}

function parseCall(parsed: ParsedArgv): { tool: string; args: JsonObject } {
  const [tool, ...rest] = parsed.positionals;
  if (!tool || rest.length > 0) throw new UsageError('favbase call expects exactly one <tool>');
  for (const name of Object.keys(parsed.flags)) {
    if (name !== 'args' && name !== 'args-file') {
      throw new UsageError(`Unknown option --${name} for favbase call`);
    }
  }
  return { tool, args: callArgs(parsed.flags) };
}

/** Probe, assemble, print: the one output path, whatever failed (docs/30 #3; see doctor.ts). */
async function runDoctor(io: CliIo, currency: Promise<CliCurrency>): Promise<number> {
  const report = assembleDoctorReport(await probeDoctor(
    { ...daemonOptions(io), homeDir: io.homeDir, skillContent: io.skillContent },
    currency,
  ));
  printJson(io, report.json);
  if (report.skillHint) io.stderr(`${report.skillHint}\n`);
  return report.failure ? printFailure(io, report.failure) : EXIT_OK;
}

async function runDaemonForeground(io: CliIo): Promise<number> {
  const config = await resolveConfig(io.env);
  const log = (message: string) => io.stderr(`${formatDaemonLogLine(message)}\n`);
  const logger: BridgeLogger = { error: log };
  const daemon = new Daemon({
    port: config.port,
    token: config.token,
    version: io.version,
    idleMinutes: daemonIdleMinutes(io.env),
    logger,
  });
  await daemon.start();
  log(`[favbase] daemon ${io.version} listening on 127.0.0.1:${config.port} (pid ${process.pid})`);
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

interface InstallSkillRequest {
  agents: SkillAgent[];
  /** `--dir`: that directory only; otherwise the personal roots of `agents`. */
  dir: string | undefined;
}

function parseInstallSkill(parsed: ParsedArgv): InstallSkillRequest {
  if (parsed.positionals.length > 0) {
    throw new UsageError('favbase install-skill takes no positional arguments');
  }
  return {
    agents: parseSkillAgents(requireValue(parsed.flags, 'agent')),
    dir: requireValue(parsed.flags, 'dir'),
  };
}

/**
 * One `favbase: <message>` line per skill copy that could not be written, the
 * way `reportFailure` prints a single `LocalFileError`. The copies that were
 * written are already on stdout; exit 1 if any failed.
 */
function reportSkillFailures(io: CliIo, failures: readonly LocalFileError[]): number {
  let code = EXIT_OK;
  for (const failure of failures) code = printFailure(io, describeError(failure));
  return code;
}

/** `--dir` is one copy: its failure throws, and nothing reaches stdout. */
async function runInstallSkill(io: CliIo, request: InstallSkillRequest): Promise<number> {
  const result = request.dir
    ? { written: await installSkill(io.skillContent, [request.dir]), failures: [] }
    : await installAgentSkills(io.skillContent, request.agents, io.homeDir, io.env);
  printJson(io, { installed: result.written });
  return reportSkillFailures(io, result.failures);
}

interface SetupRequest {
  token: string;
  port: number | null;
  skill: boolean;
}

function parseSetup(parsed: ParsedArgv): SetupRequest {
  if (parsed.positionals.length > 0) throw new UsageError('favbase setup takes no positional arguments');
  const token = parseToken(requireValue(parsed.flags, 'token'), '--token');
  if (!token) throw new UsageError(`favbase setup requires --token; ${SETUP_HINT}`);
  return {
    token,
    port: parsePort(requireValue(parsed.flags, 'port'), '--port'),
    skill: parsed.flags['no-skill'] !== true,
  };
}

/**
 * The daemon comes last: config and skills are written and reported before
 * anything that can fail on the port, so a daemon problem (exit 2) never
 * costs the user the pairing itself. It is reconciled to the token and port
 * written here, not to `resolveConfig`: `FAVBASE_TOKEN` in this shell would
 * outrank the file.
 */
async function runSetup(io: CliIo, request: SetupRequest): Promise<number> {
  const existing = await readConfigFile(io.env);
  const port = request.port ?? existing.port ?? DEFAULT_AGENT_BRIDGE_PORT;

  const path = await writeConfigFile(io.env, { token: request.token, port });
  const skills = request.skill
    ? await installAgentSkills(io.skillContent, SKILL_AGENTS, io.homeDir, io.env)
    : { written: [], failures: [] };
  printJson(io, { configPath: path, port, skills: skills.written });
  const code = reportSkillFailures(io, skills.failures);
  await adoptSetupToken({ token: request.token, port }, daemonOptions(io));
  // The config is written either way, so the next step stands.
  io.stderr('[favbase] next: run favbase doctor with Chrome open to verify the connection\n');
  return code;
}

/**
 * A command whose arguments already parsed. Parsing happens before any update
 * check starts, so an argument failure never goes online or prints the notice.
 */
interface PlannedCommand {
  update: UpdatePolicy;
  run(cli: Promise<CliCurrency>): Promise<number>;
}

function offline(run: () => Promise<number>): PlannedCommand {
  return { update: 'none', run };
}

function daily(run: () => Promise<number>): PlannedCommand {
  return { update: 'daily', run };
}

/**
 * Which commands check for a newer CLI (docs/27 D12): every data and setup
 * command, daily through the cache; doctor always, ignoring it. Never
 * `--version`, usage, or `daemon *` -- `daemon run` is the long-lived process.
 */
function plan(io: CliIo, parsed: ParsedArgv): PlannedCommand {
  if (parsed.flags.version === true) {
    return offline(async () => {
      io.stdout(`${io.version}\n`);
      return EXIT_OK;
    });
  }
  if (parsed.flags.help === true || parsed.command === null || parsed.command === 'help') {
    const code = parsed.command === null && parsed.flags.help !== true ? EXIT_USAGE : EXIT_OK;
    return offline(async () => {
      io.stdout(usage(io.version, io.env));
      return code;
    });
  }

  const alias = findAlias(parsed.command);
  if (alias) {
    const args = buildAliasArgs(alias, parsed.positionals, parsed.flags);
    return daily(() => runTool(io, alias.tool, args));
  }

  switch (parsed.command) {
    case 'tools':
      return daily(() => runTools(io));
    case 'call': {
      const call = parseCall(parsed);
      return daily(() => runTool(io, call.tool, call.args));
    }
    case 'doctor':
      return { update: 'always', run: (cli) => runDoctor(io, cli) };
    case 'daemon':
      return offline(() => runDaemonCommand(io, parsed));
    case 'setup': {
      const request = parseSetup(parsed);
      return daily(() => runSetup(io, request));
    }
    case 'install-skill': {
      const request = parseInstallSkill(parsed);
      return daily(() => runInstallSkill(io, request));
    }
    default:
      throw new UsageError(`Unknown command "${parsed.command}"`);
  }
}

/** `exit-codes.ts` classifies; this only adds the daemon log's timestamps. */
function reportFailure(io: CliIo, argv: readonly string[], error: unknown): number {
  const { exitCode, lines } = describeError(error);
  const daemonRun = argv[0] === 'daemon' && (argv[1] === undefined || argv[1] === 'run');
  const output = daemonRun
    ? lines.flatMap(line => line.split('\n')).map(line => formatDaemonLogLine(line))
    : lines;
  return printFailure(io, { exitCode, lines: output });
}

/**
 * Runs one CLI invocation and returns the process exit code. Never throws.
 * The update check runs alongside the command and is awaited at the end, so
 * the notice is the last stderr line and never touches stdout or the code.
 * The bundled skill is canonicalized to LF here, the one boundary every
 * command that writes or compares it passes through.
 */
export async function main(argv: readonly string[], rawIo: CliIo): Promise<number> {
  const io: CliIo = { ...rawIo, skillContent: canonicalSkillContent(rawIo.skillContent) };
  let cli: Promise<CliCurrency> | null = null;
  let code: number;
  try {
    const command = plan(io, parseArgv(argv));
    cli = checkCliCurrency({
      env: io.env,
      version: io.version,
      policy: command.update,
      fetchLatestVersion: io.fetchLatestVersion,
    });
    code = await command.run(cli);
  } catch (error) {
    code = reportFailure(io, argv, error);
  }
  const notice = cli ? updateNotice(await cli) : null;
  if (notice) io.stderr(`${notice}\n`);
  return code;
}
