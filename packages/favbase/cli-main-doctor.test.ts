import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { BridgePeerSnapshot } from './bridge-server';
import { formatDaemonLogLine, main, type CliIo } from './cli-main';
import {
  CHANGE_PORT_HINT,
  ConfigError,
  configPath,
  LocalFileError,
  type ConfigEnv,
  type ResolvedConfig,
} from './config';
import { DaemonError, type EnsureDaemonResult } from './daemon-client';
import { assembleDoctorReport, NOT_CONNECTED, type DoctorJson, type DoctorProbes } from './doctor';
import {
  describeError,
  EXIT_UNAVAILABLE,
  EXIT_USAGE,
  EXTENSION_LATENCY_HINT,
} from './exit-codes';
import type { StatusResponse } from './rpc-server';
import { inspectSkills, installSkill, skillRoot, type SkillAgent, type SkillCopy } from './skill-install';
import type { CliCurrency } from './update-check';

/*
 * Doctor is two halves (docs/30 #3). `assembleDoctorReport` is pure: most cases
 * below feed it real `inspectSkills` output (temp homes) and synthetic probe
 * results. `main(['doctor'])` runs only where the wiring is the point: the
 * config-error path, which never reaches a daemon, and real loopback servers
 * on free ports. Never a token with the default port -- that is the
 * developer's own daemon -- and never a token with an empty port, which would
 * spawn `cliPath` and wait out the 10 s spawn deadline.
 */

const TOKEN = 'doctor-test-token';
const VERSION = '9.9.9';
const SHIPPED_SKILL = '---\nname: favbase\n---\nshipped\n';
const SEVEN_KEYS = ['ok', 'cli', 'config', 'daemon', 'extension', 'skills', 'troubleshooting'];
/** Only path arithmetic reads it (`configPath`, `daemonLogPath`); nothing is written there. */
const ENV: ConfigEnv = { FAVBASE_HOME: join(tmpdir(), 'favbase-doctor-never-written') };
const temps: string[] = [];
const servers: Server[] = [];

const CONFIG: ResolvedConfig = {
  token: TOKEN,
  port: 17_836,
  tokenSource: 'env',
  portSource: 'env',
  configPath: configPath(ENV),
};
const CONFIG_SECTION = { path: CONFIG.configPath, port: 17_836, tokenSource: 'env', portSource: 'env' };
const ENSURED: EnsureDaemonResult = {
  health: { name: 'favbase', version: 'test', pid: 123 },
  spawned: false,
  replaced: null,
};
const UNKNOWN_CLI: CliCurrency = { version: 'test', latest: null, state: 'unknown', reason: 'not checked' };

const disconnectedExtension: BridgePeerSnapshot = {
  connected: false,
  extensionId: null,
  tools: [],
  rejectedHelloCount: 3,
  lastRejectedHelloAt: Date.parse('2026-09-01T12:34:56.000Z'),
  lastRejectedHelloReason: 'bad-token',
};
const connectedExtension: BridgePeerSnapshot = { ...disconnectedExtension, connected: true, extensionId: 'ext' };

function status(extension: BridgePeerSnapshot): StatusResponse {
  return {
    ok: true,
    daemon: { name: 'favbase', version: 'test', pid: 123, port: 17_836, startedAt: 1, idleMinutes: 120 },
    extension,
  };
}

/** The daemon answered and `/status` read `extension`. */
function reached(extension: BridgePeerSnapshot, ensured = ENSURED): DoctorProbes['link'] {
  return { reached: 'extension', config: CONFIG, ensured, status: status(extension) };
}

function assemble(probes: Partial<DoctorProbes> = {}) {
  return assembleDoctorReport({
    env: ENV,
    cli: UNKNOWN_CLI,
    skills: [],
    link: reached(disconnectedExtension),
    ...probes,
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
    server.closeAllConnections();
  }
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-doctor-'));
  temps.push(home);
  return home;
}

/** Spelled out here rather than taken from skill-install.ts, so the test pins the location. */
function legacyRoot(home: string, codexHome: boolean): string {
  return join(home, codexHome ? 'codex-home' : '.codex', 'skills');
}

interface SkillLayout {
  /** Skill copies to lay down: agent -> file content. */
  skills?: Partial<Record<SkillAgent, string>>;
  /** A copy in Codex's legacy root, `<codex home>/skills/favbase/SKILL.md`. */
  legacyCodex?: string;
  /** Set CODEX_HOME to `<home>/codex-home` instead of leaving the default `<home>/.codex`. */
  codexHome?: boolean;
}

async function layDown(home: string, layout: SkillLayout): Promise<ConfigEnv> {
  for (const [agent, content] of Object.entries(layout.skills ?? {})) {
    await installSkill(content, [skillRoot(agent as SkillAgent, home)]);
  }
  if (layout.legacyCodex !== undefined) {
    await installSkill(layout.legacyCodex, [legacyRoot(home, layout.codexHome === true)]);
  }
  return layout.codexHome ? { CODEX_HOME: join(home, 'codex-home') } : {};
}

/** Real `inspectSkills` output for `layout` under a fresh home. */
async function inspect(layout: SkillLayout = {}): Promise<{ skills: SkillCopy[]; home: string }> {
  const home = await tempHome();
  const env = await layDown(home, layout);
  return { skills: await inspectSkills(SHIPPED_SKILL, home, env), home };
}

interface CliDoctor {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed: a doctor run that prints no JSON fails here. */
  json: DoctorJson;
  io: CliIo;
}

/** `main(['doctor'])`, with skill copies under a fresh user home and FAVBASE_HOME. */
async function runDoctorCli(options: SkillLayout & {
  env?: Record<string, string>;
  /** Written to the config file before doctor runs. */
  configFile?: object;
  skillContent?: string;
} = {}): Promise<CliDoctor> {
  const home = await tempHome();
  const homeDir = join(home, 'user');
  const codexEnv = await layDown(homeDir, options);
  const env = { FAVBASE_HOME: join(home, 'favbase'), ...codexEnv, ...options.env };
  if (options.configFile) {
    await mkdir(dirname(configPath(env)), { recursive: true });
    await writeFile(configPath(env), JSON.stringify(options.configFile));
  }
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    env,
    cliPath: join(home, 'never-spawned.js'),
    homeDir,
    skillContent: options.skillContent ?? SHIPPED_SKILL,
    version: VERSION,
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
  };
  const code = await main(['doctor'], io);
  return { code, stdout, stderr, json: JSON.parse(stdout) as DoctorJson, io };
}

async function listen(handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

/**
 * The top-level keys an agent reads: through JSON.stringify, which drops a key
 * whose value is `undefined` -- `Object.keys` would still count it.
 */
const printedKeys = (json: DoctorJson) => Object.keys(JSON.parse(JSON.stringify(json)) as object);
/** A section's `problem`; `DoctorJson` only has it on some variants. */
const problemOf = (section: object) => (section as { problem?: string }).problem;
const skillLines = (stderr: string) => stderr.split('\n').filter(line => line.includes('install-skill'));

describe('favbase doctor diagnostics', () => {
  it('reports known token rejection before concrete checks without exposing the token', () => {
    const { json, failure } = assemble();

    expect(failure?.exitCode).toBe(EXIT_UNAVAILABLE);
    expect(failure?.lines[0]).toBe(`favbase: extension-unavailable: ${NOT_CONNECTED}`);
    expect(json.extension).toMatchObject({ lastRejectedHelloReason: 'bad-token' });
    expect(json.troubleshooting[0]).toContain('did not match this daemon');
    expect(json.troubleshooting[0]).toContain('2026-09-01T12:34:56.000Z');
    expect(json.troubleshooting.join(' ')).toContain('pairing token');
    expect(json.troubleshooting.join(' ')).toContain('Agent Skills is enabled');
    expect(json.troubleshooting.join(' ')).toContain('Chrome is running');
    expect(json.troubleshooting.join(' ')).toContain('17836');
    expect(json.troubleshooting.join(' ')).toContain('daemon.log');
    expect(failure?.lines.join('\n')).toContain(EXTENSION_LATENCY_HINT);
    expect(JSON.stringify(json)).not.toContain(TOKEN);
    expect(failure?.lines.join('\n')).not.toContain(TOKEN);
  });

  it('shows a replaced daemon in the daemon field', () => {
    const { json } = assemble({
      link: reached(disconnectedExtension, {
        health: { name: 'favbase', version: 'test', pid: 124 },
        spawned: true,
        replaced: { from: '0.1.0', to: '0.2.0' },
      }),
    });
    expect(json.daemon).toMatchObject({ spawned: true, replaced: { from: '0.1.0', to: '0.2.0' } });
  });

  it('formats daemon log lines with a stable ISO-8601 timestamp', () => {
    expect(formatDaemonLogLine(
      '[favbase] Agent Bridge hello rejected (bad-token)',
      Date.parse('2026-09-01T12:34:56.789Z'),
    )).toBe(
      '[2026-09-01T12:34:56.789Z] [favbase] Agent Bridge hello rejected (bad-token)',
    );
  });

  it('keeps the Agent Skill on the canonical CLI latency wording', () => {
    const skill = readFileSync(new URL('../../skills/favbase/SKILL.md', import.meta.url), 'utf8');
    const normalizedSkill = skill.replaceAll('\r', '').replaceAll('\n', ' ').replaceAll('`', '');
    expect(normalizedSkill).toContain(EXTENSION_LATENCY_HINT);
    expect(skill).not.toContain('~35 s');
    expect(skill).not.toContain('within 30 seconds');
  });
});

// docs/30 #3: every report has the same seven keys, in the same order, and a
// section doctor could not fill says why in `problem`.
describe('favbase doctor report shape', () => {
  const OUTCOMES: [name: string, link: DoctorProbes['link'], ok: boolean][] = [
    ['connected', reached(connectedExtension), true],
    ['extension not connected', reached(disconnectedExtension), false],
    ['daemon failure', { reached: 'daemon', config: CONFIG, ensured: null, error: new DaemonError('foreign', 'f') }, false],
    ['config failure', { reached: 'config', error: new ConfigError('No pairing token configured') }, false],
  ];

  it.each(OUTCOMES)('has the seven keys when %s', (_name, link, ok) => {
    const { json, failure } = assemble({ link });
    expect(printedKeys(json)).toEqual(SEVEN_KEYS);
    expect(json.ok).toBe(ok);
    expect(failure === null).toBe(ok);
  });

  it('is ok with an empty troubleshooting list when the extension is connected', () => {
    const { json, failure } = assemble({ link: reached(connectedExtension) });
    expect(failure).toBeNull();
    expect(json.troubleshooting).toEqual([]);
    expect(json.config).toEqual(CONFIG_SECTION);
    expect(json.daemon).toEqual({ ...status(connectedExtension).daemon, spawned: false, replaced: null });
  });

  // The config names no port: daemon and extension were never looked at.
  it('reports a config failure with daemon and extension not checked', () => {
    const error = new ConfigError('No pairing token configured; run favbase setup --token <token>');
    const { json, failure } = assemble({ link: { reached: 'config', error } });

    expect(failure).toEqual({ exitCode: EXIT_USAGE, lines: [`favbase: ${error.message}`] });
    expect(json.config).toEqual({ path: configPath(ENV), problem: error.message });
    expect(json.daemon).toEqual({ problem: 'not checked, because the config is unusable' });
    expect(json.extension).toEqual(json.daemon);
    expect(json.troubleshooting).toHaveLength(2);
    expect(json.troubleshooting[0]).toBe(error.message);
    expect(json.troubleshooting[1]).toMatch(
      /^The daemon and the link to the extension were not checked\b.*run favbase doctor again\.$/,
    );
  });
});

// docs/30 #3 and D5-a. Before, anything thrown by `ensureDaemon`/`fetchStatus`
// escaped doctor: one stderr line, no JSON. Now it is the daemon's `problem`,
// the exit code and stderr lines are `describeError`'s -- what any other
// command prints -- and the extension is reported as not checked, with a
// reminder instead of Chrome advice unrelated to the cause.
describe('favbase doctor when the daemon step fails', () => {
  const unauthorized = (fix: string) =>
    new DaemonError('unauthorized', `the favbase daemon on port 17836 holds a different pairing token; ${fix}`);
  const FAILURES: [name: string, error: Error, ensured: EnsureDaemonResult | null, exitCode: number][] = [
    ['foreign', new DaemonError('foreign', `127.0.0.1:17836 is served by something that is not the favbase daemon; ${CHANGE_PORT_HINT}`), null, EXIT_UNAVAILABLE],
    ['spawn-failed', new DaemonError('spawn-failed', 'favbase daemon did not answer within 10s; see /h/daemon.log'), null, EXIT_UNAVAILABLE],
    ['unauthorized (env token)', unauthorized('FAVBASE_TOKEN is set here and overrides /h/config.json; unset it so the config file applies'), ENSURED, EXIT_UNAVAILABLE],
    ['unauthorized (file token)', unauthorized('copy the setup command from favbase Settings > Connections > Agent Skills and run it again'), ENSURED, EXIT_UNAVAILABLE],
    ['protocol', new DaemonError('protocol', 'unexpected daemon response (HTTP 500)'), ENSURED, EXIT_UNAVAILABLE],
    ['unreachable (a daemon that would not stop)', new DaemonError('unreachable', `could not stop the older favbase daemon 0.1.0 (pid 7) to replace it with 0.2.0: favbase daemon (pid 7) did not exit within 5s; end process 7 yourself, or ${CHANGE_PORT_HINT}`), null, EXIT_UNAVAILABLE],
    ['unreachable (a /status that timed out)', new DaemonError('unreachable', 'timed out after 120000ms'), ENSURED, EXIT_UNAVAILABLE],
    ['a daemon.log it cannot open', new LocalFileError('cannot write /h/daemon.log: EACCES: permission denied'), null, EXIT_USAGE],
    ['a bad FAVBASE_DAEMON_IDLE_MINUTES', new ConfigError('FAVBASE_DAEMON_IDLE_MINUTES must be a non-negative number'), null, EXIT_USAGE],
    ['an untyped error', new Error('EMFILE: too many open files'), null, EXIT_USAGE],
  ];

  it.each(FAILURES)('reports %s', (_name, error, ensured, exitCode) => {
    const { json, failure } = assemble({ link: { reached: 'daemon', config: CONFIG, ensured, error } });

    expect(printedKeys(json)).toEqual(SEVEN_KEYS);
    expect(json.ok).toBe(false);
    expect(failure?.exitCode).toBe(exitCode);
    expect(failure).toEqual(describeError(error));
    expect(json.config).toEqual(CONFIG_SECTION);
    // The config resolved, so even a ConfigError here is the daemon's problem.
    expect(json.daemon).toEqual(ensured === null
      ? { problem: error.message }
      : { ...ensured.health, spawned: ensured.spawned, replaced: ensured.replaced, problem: error.message });
    expect(json.extension).toEqual({ problem: 'not checked, because the daemon is unavailable' });
    expect(json.troubleshooting).toHaveLength(2);
    expect(json.troubleshooting[0]).toBe(error.message);
    expect(json.troubleshooting[1]).toMatch(
      /^The link to the extension was not checked\b.*run favbase doctor again\.$/,
    );
    expect(json.troubleshooting.join(' ')).not.toContain('Chrome');
  });

  it('keeps the skill hint and the CLI currency beside a daemon failure', async () => {
    const { skills } = await inspect({ skills: { claude: 'old\n' } });
    const cli: CliCurrency = { version: '1.0.0', latest: '1.1.0', state: 'outdated' };
    const report = assemble({
      cli,
      skills,
      link: { reached: 'daemon', config: CONFIG, ensured: null, error: new DaemonError('foreign', 'f') },
    });
    expect(report.json.cli).toEqual(cli);
    expect(report.json.skills).toEqual(skills);
    expect(report.skillHint).toMatch(/favbase install-skill --agent claude$/);
  });
});

// Real loopback servers on free ports, through `main`: stdout must parse as
// the report, and stderr is the skill hint followed by the failure lines.
describe('favbase doctor against a port it cannot use', () => {
  it('reports a port held by a program that is not the daemon (exit 2)', async () => {
    const port = await listen((_request, response) => response.end('hello'));

    const result = await runDoctorCli({ env: { FAVBASE_TOKEN: TOKEN, FAVBASE_BRIDGE_PORT: String(port) } });

    expect(result.code).toBe(EXIT_UNAVAILABLE);
    const { json } = result;
    expect(Object.keys(json)).toEqual(SEVEN_KEYS);
    expect(json).toMatchObject({
      ok: false,
      cli: { version: VERSION },
      config: { port, tokenSource: 'env', portSource: 'env' },
      extension: { problem: 'not checked, because the daemon is unavailable' },
    });
    const problem = problemOf(json.daemon);
    expect(json.daemon).toEqual({ problem });
    expect(problem).toContain(`127.0.0.1:${port}`);
    expect(problem).toContain(CHANGE_PORT_HINT);
    expect(json.skills.map(copy => copy.state)).toEqual(['missing', 'missing']);
    expect(json.troubleshooting).toEqual([problem, expect.stringContaining('run favbase doctor again')]);

    const lines = result.stderr.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('no favbase skill is installed');
    expect(lines[1]).toBe(`favbase: foreign: ${problem}`);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  // `/health` answers as this CLI's version, so `ensureDaemon` keeps it (an
  // older one would be replaced -- and its pid signalled); `/status` refuses
  // the token. The fix is named per token source by `daemon-client.ts`.
  describe('a daemon holding another pairing token', () => {
    async function refusingDaemon(): Promise<{ port: number; requests: string[] }> {
      const requests: string[] = [];
      const port = await listen((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
        response.setHeader('content-type', 'application/json');
        if (pathname === '/health') {
          response.end(JSON.stringify({ name: 'favbase', version: VERSION, pid: 2_147_483_000 }));
        } else if (pathname === '/status') {
          response.writeHead(401).end(JSON.stringify({ ok: false, code: 'unauthorized' }));
        } else {
          response.writeHead(404).end();
        }
      });
      return { port, requests };
    }

    it.each([
      ['env', 'FAVBASE_TOKEN is set here and overrides'],
      ['file', 'copy the setup command from favbase Settings > Connections > Agent Skills and run it again'],
    ] as const)('reports it with the fix for a %s token (exit 2)', async (tokenSource, fix) => {
      const daemon = await refusingDaemon();
      const port = String(daemon.port);

      const result = await runDoctorCli(tokenSource === 'env'
        ? { env: { FAVBASE_TOKEN: TOKEN, FAVBASE_BRIDGE_PORT: port } }
        : { env: { FAVBASE_BRIDGE_PORT: port }, configFile: { token: TOKEN } });

      expect(result.code).toBe(EXIT_UNAVAILABLE);
      const { json } = result;
      expect(Object.keys(json)).toEqual(SEVEN_KEYS);
      expect(json.config).toMatchObject({ tokenSource, port: daemon.port });
      const problem = problemOf(json.daemon);
      // What `ensureDaemon` found stays beside the `/status` failure.
      expect(json.daemon).toEqual({
        name: 'favbase',
        version: VERSION,
        pid: 2_147_483_000,
        spawned: false,
        replaced: null,
        problem,
      });
      expect(problem).toContain(`port ${daemon.port} holds a different pairing token`);
      expect(problem).toContain(fix);
      expect(json.extension).toEqual({ problem: 'not checked, because the daemon is unavailable' });
      expect(json.troubleshooting).toEqual([problem, expect.stringContaining('run favbase doctor again')]);
      expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(`favbase: unauthorized: ${problem}`);
      expect(result.stdout + result.stderr).not.toContain(TOKEN);
      // Asked once, waiting, and nothing stopped or replaced.
      expect(daemon.requests).toEqual(['GET /health', 'GET /status?wait=1']);
    });
  });
});

// docs/27 Step 2 (L1) and D11: doctor reports each personal skill copy as
// current / stale / missing, and says so on stderr only when a copy is stale
// or every copy is missing -- one missing side is taken as deliberate.
describe('favbase doctor skill copies', () => {
  it('reports all three states in the JSON and names only the stale agent', async () => {
    const { skills } = await inspect({ skills: { claude: 'older skill\n' } });
    const { json, skillHint } = assemble({ skills });

    expect(json.skills.map(({ agent, state }) => ({ agent, state }))).toEqual([
      { agent: 'claude', state: 'stale' },
      { agent: 'codex', state: 'missing' },
    ]);
    expect(skillHint).toContain('favbase install-skill --agent claude');
    expect(skillHint).not.toContain('codex');
  });

  it('names every stale agent, never a bare install-skill', async () => {
    const { skills } = await inspect({ skills: { claude: 'old\n', codex: 'old\n' } });
    expect(assemble({ skills }).skillHint).toMatch(/favbase install-skill --agent claude,codex$/);
  });

  it('stays quiet when one copy is current and the other missing', async () => {
    const { skills } = await inspect({ skills: { claude: SHIPPED_SKILL } });
    const { json, skillHint } = assemble({ skills });
    expect(json.skills.map(copy => copy.state)).toEqual(['current', 'missing']);
    expect(skillHint).toBeNull();
  });

  it('stays quiet when every copy is current', async () => {
    const { skills } = await inspect({ skills: { claude: SHIPPED_SKILL, codex: SHIPPED_SKILL } });
    expect(assemble({ skills }).skillHint).toBeNull();
  });

  // A CRLF-bundled skill (a release built from a CRLF checkout) must not turn
  // every LF copy -- including one from `npx skills add` -- stale forever.
  // Through `main`: canonicalizing the bundled skill is its job. No token, so
  // doctor stops at the config and never looks for a daemon.
  it('reports an LF copy as current when the bundled skill is CRLF', async () => {
    const result = await runDoctorCli({
      skillContent: SHIPPED_SKILL.replaceAll('\n', '\r\n'),
      skills: { claude: SHIPPED_SKILL },
    });
    expect(result.json.skills.map(copy => copy.state)).toEqual(['current', 'missing']);
    expect(skillLines(result.stderr)).toEqual([]);
  });

  it('suggests install-skill and warns that --dir copies are invisible when every copy is missing', async () => {
    const { skills } = await inspect();
    const { skillHint } = assemble({ skills });
    expect(skillHint).toContain('favbase install-skill');
    expect(skillHint).not.toContain('--agent');
    expect(skillHint).toContain('--dir');
  });

  // Through `main`, for the stderr order: JSON, the skill hint, then the
  // failure lines -- here the one line any command prints for this error.
  it('reports skills and cli on the config-error path too', async () => {
    const result = await runDoctorCli({ skills: { codex: 'old\n' } });
    expect(result.code).toBe(EXIT_USAGE);
    const { json } = result;
    const problem = problemOf(json.config);
    expect(problem).toContain('No pairing token');
    expect(json.cli).toMatchObject({ version: VERSION, state: 'unknown' });
    expect(json.skills.map(copy => copy.state)).toEqual(['missing', 'stale']);
    expect(json.daemon).toEqual({ problem: 'not checked, because the config is unusable' });
    expect(skillLines(result.stderr)).toEqual([
      expect.stringContaining('favbase install-skill --agent codex'),
    ]);
    // docs/30 #2: the exit-1 row tells an agent to show the user the stderr
    // message, and the fix (`favbase setup`) used to be only in stdout.
    expect(result.stderr.split('\n').at(-2)).toBe(`favbase: ${problem}`);
    expect(problem).toContain('favbase setup --token');
  });

  // `stale` has no direction: a copy from GitHub main can be newer than this
  // CLI, and install-skill would roll it back. Upgrading first avoids that.
  it('tells an outdated CLI to upgrade before refreshing a stale copy', async () => {
    const { skills } = await inspect({ skills: { claude: 'newer from main\n' } });
    const { json, skillHint } = assemble({
      skills,
      cli: { version: '1.0.0', latest: '1.1.0', state: 'outdated' },
    });
    expect(skillHint).toMatch(/npm install -g favbase@latest.*favbase install-skill --agent claude/);
    expect(json).toMatchObject({ cli: { state: 'outdated', latest: '1.1.0' } });
  });

  it('never lets skill or CLI currency change ok or the exit code', async () => {
    const { skills } = await inspect({ skills: { claude: 'old\n' } });
    const outdated = assemble({
      skills,
      cli: { version: '1.0.0', latest: '2.0.0', state: 'outdated' },
      link: reached(connectedExtension),
    });
    expect(outdated.failure).toBeNull();
    expect(outdated.json).toMatchObject({ ok: true, cli: { state: 'outdated' } });
    expect(outdated.skillHint).not.toBeNull();

    const stale = assemble({ skills, link: reached(connectedExtension) });
    expect(stale.failure).toBeNull();
    expect(stale.json.ok).toBe(true);
  });
});

// Codex still scans its deprecated `$CODEX_HOME/skills` (default `~/.codex`)
// besides `~/.agents/skills`. Doctor lists a copy there as one more codex copy,
// only when it exists, so a machine without one sees exactly the two entries
// the tests above pin.
describe('favbase doctor and the legacy Codex root', () => {
  const current = { claude: SHIPPED_SKILL, codex: SHIPPED_SKILL };
  const legacyCopy = (home: string, codexHome = false) =>
    join(legacyRoot(home, codexHome), 'favbase', 'SKILL.md');

  it('lists a stale legacy copy as codex and names codex in the hint', async () => {
    const { skills, home } = await inspect({ skills: current, legacyCodex: 'old\n' });
    const { json, skillHint } = assemble({ skills });

    expect(json.skills).toHaveLength(3);
    expect(json.skills[2]).toEqual({ agent: 'codex', path: legacyCopy(home), state: 'stale' });
    expect(skillHint).toMatch(/the installed skill for codex differs.*favbase install-skill --agent codex$/);
  });

  it('names codex once when both of its copies are stale', async () => {
    const { skills } = await inspect({ skills: { claude: 'old\n', codex: 'old\n' }, legacyCodex: 'old\n' });
    expect(assemble({ skills }).skillHint).toMatch(
      /for claude and codex differs.*favbase install-skill --agent claude,codex$/,
    );
  });

  it('lists a current legacy copy and stays quiet about it', async () => {
    const { skills } = await inspect({ skills: current, legacyCodex: SHIPPED_SKILL });
    const { json, skillHint } = assemble({ skills });
    expect(json.skills.map(copy => copy.state)).toEqual(['current', 'current', 'current']);
    expect(skillHint).toBeNull();
  });

  // What install-skill leaves on a cc-switch machine: it creates no `.agents`
  // copy beside a legacy one, so that row stays missing for good. A hint about
  // it would send the user to an install-skill that never clears it.
  it('stays quiet about a missing .agents copy when the legacy copy is current', async () => {
    const { skills } = await inspect({ skills: { claude: SHIPPED_SKILL }, legacyCodex: SHIPPED_SKILL });
    const { json, skillHint } = assemble({ skills });
    expect(json.skills.map(({ agent, state }) => ({ agent, state }))).toEqual([
      { agent: 'claude', state: 'current' },
      { agent: 'codex', state: 'missing' },
      { agent: 'codex', state: 'current' },
    ]);
    expect(skillHint).toBeNull();
  });

  it('looks under CODEX_HOME when it is set', async () => {
    const { skills, home } = await inspect({ skills: current, legacyCodex: 'old\n', codexHome: true });
    const { json } = assemble({ skills });
    expect(json.skills[2]).toEqual({
      agent: 'codex',
      path: legacyCopy(home, true),
      state: 'stale',
    });
  });
});
