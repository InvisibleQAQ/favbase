import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const daemonMocks = vi.hoisted(() => ({
  ensureDaemon: vi.fn(),
  fetchStatus: vi.fn(),
}));

vi.mock('./daemon-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./daemon-client')>()),
  ensureDaemon: daemonMocks.ensureDaemon,
  fetchStatus: daemonMocks.fetchStatus,
}));

import {
  EXIT_OK,
  EXIT_UNAVAILABLE,
  EXIT_USAGE,
  EXTENSION_LATENCY_HINT,
  formatDaemonLogLine,
  main,
  type CliIo,
} from './cli-main';
import { installSkill, skillRoot, type SkillAgent } from './skill-install';

const TOKEN = 'doctor-test-token';
const SHIPPED_SKILL = '---\nname: favbase\n---\nshipped\n';
const temps: string[] = [];

const disconnectedExtension = {
  connected: false,
  extensionId: null,
  tools: [],
  rejectedHelloCount: 3,
  lastRejectedHelloAt: Date.parse('2026-09-01T12:34:56.000Z'),
  lastRejectedHelloReason: 'bad-token',
};

function status(extension: object) {
  return {
    ok: true,
    daemon: {
      name: 'favbase',
      version: 'test',
      pid: 123,
      port: 17_836,
      startedAt: 1,
      idleMinutes: 120,
    },
    extension,
  };
}

beforeEach(() => {
  daemonMocks.ensureDaemon.mockReset().mockResolvedValue({
    health: { name: 'favbase', version: 'test', pid: 123 },
    spawned: false,
    replaced: null,
  });
  daemonMocks.fetchStatus.mockReset().mockResolvedValue(status(disconnectedExtension));
});

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

interface DoctorOptions {
  /** Skill copies to lay down before doctor runs: agent -> file content. */
  skills?: Partial<Record<SkillAgent, string>>;
  withToken?: boolean;
  /** The SKILL.md bundled into the CLI; defaults to `SHIPPED_SKILL`. */
  skillContent?: string;
  version?: string;
  fetchLatestVersion?: () => Promise<string | null>;
}

async function runDoctor(
  options: DoctorOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-doctor-'));
  temps.push(home);
  for (const [agent, content] of Object.entries(options.skills ?? {})) {
    await installSkill(content, [skillRoot(agent as SkillAgent, home)]);
  }
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    env: {
      FAVBASE_HOME: join(home, 'favbase'),
      ...(options.withToken === false ? {} : { FAVBASE_TOKEN: TOKEN }),
      FAVBASE_BRIDGE_PORT: '17836',
    },
    cliPath: join(home, 'cli.js'),
    homeDir: home,
    skillContent: options.skillContent ?? SHIPPED_SKILL,
    version: options.version ?? 'test',
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
    fetchLatestVersion: options.fetchLatestVersion,
  };
  return { code: await main(['doctor'], io), stdout, stderr };
}

interface DoctorJson {
  ok: boolean;
  cli: { version: string; latest: string | null; state: string; reason?: string };
  daemon?: { replaced: unknown };
  skills: Array<{ agent: string; path: string; state: string }>;
}

const skillLines = (stderr: string) => stderr.split('\n').filter(line => line.includes('install-skill'));

describe('favbase doctor diagnostics', () => {
  it('reports known token rejection before concrete checks without exposing the token', async () => {
    const result = await runDoctor();
    const output = JSON.parse(result.stdout) as {
      troubleshooting: string[];
      extension: { lastRejectedHelloReason: string };
    };

    expect(result.code).toBe(EXIT_UNAVAILABLE);
    expect(output.extension.lastRejectedHelloReason).toBe('bad-token');
    expect(output.troubleshooting[0]).toContain('did not match this daemon');
    expect(output.troubleshooting.join(' ')).toContain('pairing token');
    expect(output.troubleshooting.join(' ')).toContain('Agent Skills is enabled');
    expect(output.troubleshooting.join(' ')).toContain('Chrome is running');
    expect(output.troubleshooting.join(' ')).toContain('17836');
    expect(output.troubleshooting.join(' ')).toContain('daemon.log');
    expect(result.stderr).toContain(EXTENSION_LATENCY_HINT);
    expect(result.stdout).not.toContain(TOKEN);
    expect(result.stderr).not.toContain(TOKEN);
  });

  it('shows a replaced daemon in the daemon field', async () => {
    daemonMocks.ensureDaemon.mockResolvedValueOnce({
      health: { name: 'favbase', version: 'test', pid: 124 },
      spawned: true,
      replaced: { from: '0.1.0', to: '0.2.0' },
    });
    const output = JSON.parse((await runDoctor()).stdout) as DoctorJson;
    expect(output.daemon?.replaced).toEqual({ from: '0.1.0', to: '0.2.0' });
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

// docs/27 Step 2 (L1) and D11: doctor reports each personal skill copy as
// current / stale / missing, and says so on stderr only when a copy is stale
// or every copy is missing -- one missing side is taken as deliberate.
describe('favbase doctor skill copies', () => {
  it('reports all three states in the JSON and names only the stale agent', async () => {
    const result = await runDoctor({ skills: { claude: 'older skill\n' } });
    const output = JSON.parse(result.stdout) as DoctorJson;

    expect(output.skills.map(({ agent, state }) => ({ agent, state }))).toEqual([
      { agent: 'claude', state: 'stale' },
      { agent: 'codex', state: 'missing' },
    ]);
    expect(skillLines(result.stderr)).toEqual([
      expect.stringContaining('favbase install-skill --agent claude'),
    ]);
    expect(skillLines(result.stderr)[0]).not.toContain('codex');
  });

  it('names every stale agent, never a bare install-skill', async () => {
    const result = await runDoctor({ skills: { claude: 'old\n', codex: 'old\n' } });
    expect(skillLines(result.stderr)).toEqual([
      expect.stringMatching(/favbase install-skill --agent claude,codex$/),
    ]);
  });

  it('stays quiet when one copy is current and the other missing', async () => {
    const result = await runDoctor({ skills: { claude: SHIPPED_SKILL } });
    const output = JSON.parse(result.stdout) as DoctorJson;
    expect(output.skills.map(copy => copy.state)).toEqual(['current', 'missing']);
    expect(skillLines(result.stderr)).toEqual([]);
  });

  it('stays quiet when every copy is current', async () => {
    const result = await runDoctor({ skills: { claude: SHIPPED_SKILL, codex: SHIPPED_SKILL } });
    expect(skillLines(result.stderr)).toEqual([]);
  });

  // A CRLF-bundled skill (a release built from a CRLF checkout) must not turn
  // every LF copy -- including one from `npx skills add` -- stale forever.
  it('reports an LF copy as current when the bundled skill is CRLF', async () => {
    const result = await runDoctor({
      skillContent: SHIPPED_SKILL.replaceAll('\n', '\r\n'),
      skills: { claude: SHIPPED_SKILL },
    });
    const output = JSON.parse(result.stdout) as DoctorJson;
    expect(output.skills.map(copy => copy.state)).toEqual(['current', 'missing']);
    expect(skillLines(result.stderr)).toEqual([]);
  });

  it('suggests install-skill and warns that --dir copies are invisible when every copy is missing', async () => {
    const result = await runDoctor();
    const [line] = skillLines(result.stderr);
    expect(line).toContain('favbase install-skill');
    expect(line).not.toContain('--agent');
    expect(line).toContain('--dir');
  });

  it('reports skills and cli on the config-error path too', async () => {
    const result = await runDoctor({ withToken: false, skills: { codex: 'old\n' } });
    expect(result.code).toBe(EXIT_USAGE);
    const output = JSON.parse(result.stdout) as DoctorJson & { config: { problem: string } };
    expect(output.config.problem).toContain('No pairing token');
    expect(output.cli).toMatchObject({ version: 'test', state: 'unknown' });
    expect(output.skills.map(copy => copy.state)).toEqual(['missing', 'stale']);
    expect(skillLines(result.stderr)).toEqual([
      expect.stringContaining('favbase install-skill --agent codex'),
    ]);
    expect(daemonMocks.ensureDaemon).not.toHaveBeenCalled();
  });

  // `stale` has no direction: a copy from GitHub main can be newer than this
  // CLI, and install-skill would roll it back. Upgrading first avoids that.
  it('tells an outdated CLI to upgrade before refreshing a stale copy', async () => {
    const result = await runDoctor({
      version: '1.0.0',
      skills: { claude: 'newer from main\n' },
      fetchLatestVersion: async () => '1.1.0',
    });
    const [line] = skillLines(result.stderr);
    expect(line).toMatch(/npm install -g favbase@latest.*favbase install-skill --agent claude/);
    expect(JSON.parse(result.stdout)).toMatchObject({ cli: { state: 'outdated', latest: '1.1.0' } });
  });

  it('never lets skill or CLI currency change ok or the exit code', async () => {
    daemonMocks.fetchStatus.mockResolvedValue(
      status({ ...disconnectedExtension, connected: true, extensionId: 'ext' }),
    );
    const result = await runDoctor({
      version: '1.0.0',
      skills: { claude: 'old\n' },
      fetchLatestVersion: async () => '2.0.0',
    });
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, cli: { state: 'outdated' } });

    const stale = await runDoctor({ skills: { claude: 'old\n' } });
    expect(stale.code).toBe(EXIT_OK);
  });
});
