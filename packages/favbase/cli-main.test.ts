import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXIT_OK, EXIT_USAGE, main, type CliIo } from './cli-main';
import { configPath, favbaseHome } from './config';
import { UPDATE_CHECK_TTL_MS, updateCheckPath } from './update-check';

const SKILL = '---\nname: favbase\n---\nbody\n';
const VERSION = '9.9.9';
const NEWER = '10.0.0';
const temps: string[] = [];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  io: CliIo;
}

async function run(
  argv: string[],
  env: Record<string, string> = {},
  overrides: Partial<CliIo> = {},
): Promise<Run> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-'));
  temps.push(home);
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    env: { FAVBASE_HOME: join(home, 'favbase'), ...env },
    cliPath: join(home, 'never-spawned.js'),
    homeDir: join(home, 'user'),
    skillContent: SKILL,
    version: VERSION,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    ...overrides,
  };
  return { code: await main(argv, io), stdout, stderr, io };
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('favbase CLI dispatch', () => {
  it('prints usage (exit 1) with no command and usage (exit 0) on --help', async () => {
    const bare = await run([]);
    expect(bare.code).toBe(EXIT_USAGE);
    expect(bare.stdout).toContain('search <query>');
    expect(bare.stdout).toContain('Exit codes');

    const help = await run(['search', '--help']);
    expect(help.code).toBe(EXIT_OK);
    expect((await run(['--version'])).stdout).toBe('9.9.9\n');
  });

  it('reports unknown commands, bad alias usage and bad call arguments as usage errors', async () => {
    expect(await run(['frobnicate'])).toMatchObject({ code: EXIT_USAGE });
    expect((await run(['search', 'a', 'b'])).stderr).toContain('exactly one <query>');
    expect((await run(['call'])).stderr).toContain('exactly one <tool>');
    expect((await run(['call', 'listTags', '--args', '[1]'])).stderr).toContain('JSON object');
    expect((await run(['daemon', 'bogus'])).stderr).toContain('run, start, stop or restart');
  });

  it('refuses data commands until a token is configured, before touching any daemon', async () => {
    const result = await run(['tags']);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('favbase setup --token');
  });

  // docs/27 Step 6: with a token configured, only the argument check stands
  // between this call and a daemon auto-start. The order is not a structural
  // property: `buildAliasArgs` runs first only because it is an argument to
  // `runTool`. Move it past `connectedConfig` and this goes red: the call then
  // sits waiting on a spawn of the never-spawnable `cliPath` until it times out.
  it('refuses a non-positive --limit as a usage error before touching any daemon', async () => {
    const result = await run(['search', 'q', '--limit', '0'], {
      FAVBASE_TOKEN: 'abc',
      FAVBASE_BRIDGE_PORT: '1',
    });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('Option --limit must be a positive integer');

    // SKILL.md tells an agent to recognise a usage error by this closing line
    // (and fix its command) rather than send the user to `favbase setup`.
    const skill = readFileSync(new URL('../../skills/favbase/SKILL.md', import.meta.url), 'utf8');
    expect(skill).toContain(result.stderr.trim().split('\n').at(-1));
  });

  it('setup writes the config file and installs the skill for every agent', async () => {
    const result = await run(['setup', '--token', 'abc', '--port', '2222']);
    expect(result.code).toBe(EXIT_OK);

    const path = configPath(result.io.env);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ token: 'abc', port: 2222 });
    const output = JSON.parse(result.stdout) as { configPath: string; port: number; skills: string[] };
    expect(output).toMatchObject({ configPath: path, port: 2222 });
    expect(output.skills).toEqual([
      join(result.io.homeDir, '.claude', 'skills', 'favbase', 'SKILL.md'),
      join(result.io.homeDir, '.agents', 'skills', 'favbase', 'SKILL.md'),
    ]);
    for (const skill of output.skills) await expect(readFile(skill, 'utf8')).resolves.toBe(SKILL);
    expect(result.stderr).toContain('favbase doctor');
  });

  it('setup keeps the previous port, honours --no-skill and requires --token', async () => {
    const first = await run(['setup', '--token', 'abc', '--port', '2222']);
    const env = first.io.env as Record<string, string>;
    const second = await run(['setup', '--token', 'def', '--no-skill'], env);
    expect(JSON.parse(second.stdout)).toMatchObject({ port: 2222, skills: [] });
    expect(JSON.parse(await readFile(configPath(env), 'utf8'))).toEqual({ token: 'def', port: 2222 });

    const missing = await run(['setup']);
    expect(missing.code).toBe(EXIT_USAGE);
    expect(missing.stderr).toContain('--token');
  });

  it('install-skill targets a chosen agent or an explicit directory', async () => {
    const codex = await run(['install-skill', '--agent', 'codex']);
    expect(JSON.parse(codex.stdout)).toEqual({
      installed: [join(codex.io.homeDir, '.agents', 'skills', 'favbase', 'SKILL.md')],
    });

    const custom = await run(['install-skill', '--dir', join(codex.io.homeDir, 'custom')]);
    expect(JSON.parse(custom.stdout)).toEqual({
      installed: [join(codex.io.homeDir, 'custom', 'favbase', 'SKILL.md')],
    });
    expect((await run(['install-skill', '--agent', 'cursor'])).stderr).toContain('Unknown agent');
  });

  // Doctor prints `install-skill --agent claude,codex` for two stale copies.
  // In Windows PowerShell, npm's `favbase.ps1` shim re-splats that unquoted
  // list joined by a space, so node receives `claude codex` (both flag forms);
  // see `skill-install.ts` in packages/favbase/CLAUDE.md.
  it.each([
    [['install-skill', '--agent', 'claude codex']],
    [['install-skill', '--agent=claude codex']],
    [['install-skill', '--agent', 'claude,codex']],
  ])('install-skill installs both agents for %j', async (argv) => {
    const result = await run(argv);
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual({
      installed: [
        join(result.io.homeDir, '.claude', 'skills', 'favbase', 'SKILL.md'),
        join(result.io.homeDir, '.agents', 'skills', 'favbase', 'SKILL.md'),
      ],
    });
  });

  it.each([[','], [' ']])('install-skill refuses an agent list of separators only (%j)', async (value) => {
    const result = await run(['install-skill', '--agent', value]);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('Unknown agent');
  });

  // A release built from a CRLF checkout would bundle a CRLF SKILL.md. `main`
  // canonicalizes it, so what lands on disk is the LF text GitHub also serves.
  it('install-skill writes LF even when the bundled skill is CRLF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'favbase-crlf-'));
    temps.push(dir);
    const result = await run(['install-skill', '--dir', dir], {}, {
      skillContent: SKILL.replaceAll('\n', '\r\n'),
    });
    expect(result.code).toBe(EXIT_OK);
    const written = await readFile(join(dir, 'favbase', 'SKILL.md'), 'utf8');
    expect(written).not.toContain('\r');
    expect(written).toBe(SKILL);
  });
});

// docs/27 Step 2 (L3, D12): a daily cached check against the npm registries.
// `fetchLatestVersion` is the seam; these tests only ever inject a fake.
describe('favbase update check', () => {
  const HOUR = 60 * 60 * 1000;

  /** A scratch FAVBASE_HOME and user home shared by every run in one test. */
  async function scratch(): Promise<{ env: Record<string, string>; homeDir: string; cache: string }> {
    const root = await mkdtemp(join(tmpdir(), 'favbase-update-'));
    temps.push(root);
    const env = { FAVBASE_HOME: join(root, 'favbase') };
    return { env, homeDir: join(root, 'user'), cache: updateCheckPath(env) };
  }

  async function seed(cache: string, value: unknown): Promise<void> {
    await mkdir(join(cache, '..'), { recursive: true });
    await writeFile(cache, JSON.stringify(value), 'utf8');
  }

  async function readCache(cache: string): Promise<{ checkedAt: number; latest: string | null }> {
    return JSON.parse(await readFile(cache, 'utf8')) as { checkedAt: number; latest: string | null };
  }

  const notices = (stderr: string) => stderr.split('\n').filter(line => line.includes('is available'));
  const localCommand = ['install-skill', '--agent', 'claude'];

  it('answers from a fresh cache without asking a registry', async () => {
    const { env, homeDir, cache } = await scratch();
    await seed(cache, { checkedAt: Date.now() - HOUR, latest: NEWER });
    const before = await readFile(cache, 'utf8');
    const fetchLatestVersion = vi.fn(async () => '0.0.1');

    const result = await run(localCommand, env, { homeDir, fetchLatestVersion });

    expect(fetchLatestVersion).not.toHaveBeenCalled();
    expect(notices(result.stderr)).toHaveLength(1);
    expect(await readFile(cache, 'utf8')).toBe(before);
  });

  it('asks once and rewrites the cache when it is a day old', async () => {
    const { env, homeDir, cache } = await scratch();
    await seed(cache, { checkedAt: Date.now() - UPDATE_CHECK_TTL_MS - HOUR, latest: VERSION });
    const fetchLatestVersion = vi.fn(async () => NEWER);
    const started = Date.now();

    const result = await run(localCommand, env, { homeDir, fetchLatestVersion });

    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
    const written = await readCache(cache);
    expect(written.latest).toBe(NEWER);
    expect(written.checkedAt).toBeGreaterThanOrEqual(started);
    expect(notices(result.stderr)).toHaveLength(1);
  });

  it('does not trust a cache stamped in the future', async () => {
    const { env, homeDir, cache } = await scratch();
    await seed(cache, { checkedAt: Date.now() + HOUR, latest: VERSION });
    const fetchLatestVersion = vi.fn(async () => VERSION);
    await run(localCommand, env, { homeDir, fetchLatestVersion });
    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
  });

  it('caches a failed check with its time, prints nothing, and does not retry within the day', async () => {
    const { env, homeDir, cache } = await scratch();
    const fetchLatestVersion = vi.fn(async (): Promise<string | null> => null);
    const started = Date.now();

    const first = await run(localCommand, env, { homeDir, fetchLatestVersion });
    expect(first.code).toBe(EXIT_OK);
    expect(notices(first.stderr)).toEqual([]);
    const written = await readCache(cache);
    expect(written.latest).toBeNull();
    expect(written.checkedAt).toBeGreaterThanOrEqual(started);

    await run(localCommand, env, { homeDir, fetchLatestVersion });
    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);

    // A seam that throws is a failed check too, never a failed command.
    const throwing = await scratch();
    const crashed = await run(localCommand, throwing.env, {
      homeDir: throwing.homeDir,
      fetchLatestVersion: async () => { throw new Error('boom'); },
    });
    expect(crashed.code).toBe(EXIT_OK);
    expect((await readCache(throwing.cache)).latest).toBeNull();
  });

  it('prints the notice once, last, on stderr only, leaving stdout and the exit code alone', async () => {
    const { env, homeDir } = await scratch();
    const plain = await run(localCommand, env, { homeDir });
    const outdated = await run(localCommand, env, { homeDir, fetchLatestVersion: async () => NEWER });

    expect(outdated.stdout).toBe(plain.stdout);
    expect(outdated.code).toBe(plain.code);
    expect(notices(outdated.stdout)).toEqual([]);
    expect(notices(outdated.stderr)).toHaveLength(1);
    expect(outdated.stderr.trim().split('\n').at(-1)).toBe(notices(outdated.stderr)[0]);

    // A failing command keeps its own exit code; the notice still comes last.
    const failing = await run(['tags'], env, { homeDir, fetchLatestVersion: async () => NEWER });
    expect(failing.code).toBe(EXIT_USAGE);
    expect(failing.stderr.trim().split('\n').at(-1)).toContain('is available');
  });

  it('stays quiet when the installed CLI is current or ahead of the registry', async () => {
    for (const latest of [VERSION, '9.0.0']) {
      const { env, homeDir } = await scratch();
      const result = await run(localCommand, env, { homeDir, fetchLatestVersion: async () => latest });
      expect(notices(result.stderr)).toEqual([]);
    }
  });

  it('skips the query and the cache entirely when FAVBASE_NO_UPDATE_CHECK is set', async () => {
    for (const value of ['1', 'true', 'yes']) {
      const { env, homeDir, cache } = await scratch();
      await seed(cache, { checkedAt: Date.now() - HOUR, latest: NEWER });
      const before = await readFile(cache, 'utf8');
      const fetchLatestVersion = vi.fn(async () => NEWER);

      const result = await run(localCommand, { ...env, FAVBASE_NO_UPDATE_CHECK: value }, {
        homeDir,
        fetchLatestVersion,
      });

      expect(fetchLatestVersion).not.toHaveBeenCalled();
      expect(notices(result.stderr)).toEqual([]);
      expect(await readFile(cache, 'utf8')).toBe(before);
    }

    // `0` and an empty value leave the check on.
    for (const value of ['0', '']) {
      const { env, homeDir } = await scratch();
      const fetchLatestVersion = vi.fn(async () => NEWER);
      await run(localCommand, { ...env, FAVBASE_NO_UPDATE_CHECK: value }, { homeDir, fetchLatestVersion });
      expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
    }
  });

  it('says why doctor cannot tell when the check is switched off', async () => {
    const { env, homeDir } = await scratch();
    const fetchLatestVersion = vi.fn(async () => NEWER);
    const result = await run(['doctor'], { ...env, FAVBASE_NO_UPDATE_CHECK: '1' }, { homeDir, fetchLatestVersion });

    expect(fetchLatestVersion).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toMatchObject({
      cli: { version: VERSION, latest: null, state: 'unknown', reason: expect.stringContaining('FAVBASE_NO_UPDATE_CHECK') },
    });
  });

  it.each([
    [['daemon', 'run']],
    [['daemon', 'stop']],
    [['daemon', 'restart']],
    [['--version']],
    [['--help']],
    [['search', '--help']],
    [[]],
    [['frobnicate']],
    [['search']],
    [['search', 'q', '--limit', '0']],
    [['call']],
    [['call', 'listTags', '--args', '[1]']],
    [['setup']],
    [['setup', '--token', 'abc', '--port', 'not-a-port']],
    [['install-skill', '--agent', 'cursor']],
  ])('never checks for %j', async (argv) => {
    const { env, homeDir, cache } = await scratch();
    const fetchLatestVersion = vi.fn(async () => NEWER);

    const result = await run(argv, env, { homeDir, fetchLatestVersion });

    expect(fetchLatestVersion).not.toHaveBeenCalled();
    expect(existsSync(cache)).toBe(false);
    expect(notices(result.stderr)).toEqual([]);
  });

  it('doctor ignores the cache, asks the registry, and records the answer', async () => {
    const { env, homeDir, cache } = await scratch();
    await seed(cache, { checkedAt: Date.now() - HOUR, latest: '0.0.1' });
    const fetchLatestVersion = vi.fn(async () => NEWER);

    const result = await run(['doctor'], env, { homeDir, fetchLatestVersion });

    expect(fetchLatestVersion).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      cli: { version: VERSION, latest: NEWER, state: 'outdated' },
    });
    expect((await readCache(cache)).latest).toBe(NEWER);
    expect(notices(result.stderr)).toHaveLength(1);
  });

  it('keeps the cache under FAVBASE_HOME', async () => {
    const { env, cache } = await scratch();
    expect(cache).toBe(join(favbaseHome(env), 'update-check.json'));
  });

  // SKILL.md tells an agent what to do with this line, and the npm README shows
  // it to a person, so both must quote the line the CLI really prints --
  // versions replaced by placeholders.
  it('prints exactly the notice SKILL.md and the README quote', async () => {
    const { env, homeDir } = await scratch();
    const result = await run(localCommand, env, { homeDir, fetchLatestVersion: async () => NEWER });
    const [line] = notices(result.stderr);
    const quoted = line.replace(NEWER, '<latest>').replace(VERSION, '<version>');
    expect(quoted).toContain('<latest>');
    expect(quoted).toContain('<version>');

    for (const doc of ['../../skills/favbase/SKILL.md', './README.md']) {
      const text = readFileSync(new URL(doc, import.meta.url), 'utf8');
      expect(text, `${doc} no longer quotes the update notice the CLI prints`).toContain(quoted);
    }
  });
});
