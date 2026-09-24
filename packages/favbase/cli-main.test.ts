import { once } from 'node:events';
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXIT_OK, EXIT_USAGE, main, type CliIo } from './cli-main';
import { configPath, favbaseHome } from './config';
import { UPDATE_CHECK_TTL_MS, updateCheckPath } from './update-check';

const SKILL = '---\nname: favbase\n---\nbody\n';
const VERSION = '9.9.9';
const NEWER = '10.0.0';
const temps: string[] = [];
const servers: Server[] = [];

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

/** A user home under a fresh temp root; nothing exists at it yet. */
async function userHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'favbase-user-'));
  temps.push(root);
  return join(root, 'user');
}

/**
 * A loopback stand-in for the daemon. `/health` answers as this CLI's own
 * version, so `ensureDaemon` keeps it, and `/rpc` records the call. Every
 * request is logged, so a usage error can show it never got this far.
 */
async function fakeDaemon(): Promise<{ env: Record<string, string>; requests: string[]; calls: unknown[] }> {
  const requests: string[] = [];
  const calls: unknown[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      response.writeHead(request.url === '/health' || request.url === '/rpc' ? 200 : 404, {
        'content-type': 'application/json',
      });
      if (request.url === '/health') {
        // Never signalled: equal versions are kept, and nothing asks /shutdown.
        response.end(JSON.stringify({ name: 'favbase', version: VERSION, pid: 2_147_483_000 }));
        return;
      }
      if (request.url === '/rpc') {
        calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.end(JSON.stringify({ ok: true, result: { answered: true } }));
        return;
      }
      response.end();
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { env: { FAVBASE_TOKEN: 'abc', FAVBASE_BRIDGE_PORT: String(port) }, requests, calls };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
    server.closeAllConnections();
  }
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

  // Last-wins turned the install into codex alone, exit 0, and the search into
  // `--limit 5` -- which with a token configured sits on a spawn of the
  // never-spawnable `cliPath`. The parser refuses both before `plan`, so
  // nothing is installed under the user home and no daemon or registry is asked.
  it.each([
    [['install-skill', '--agent', 'claude', '--agent', 'codex'], 'agent'],
    [['search', 'q', '--limit=3', '--limit', '5'], 'limit'],
  ])('refuses %j as a usage error before doing anything', async (argv, name) => {
    const fetchLatestVersion = vi.fn(async () => NEWER);
    const result = await run(argv, { FAVBASE_TOKEN: 'abc', FAVBASE_BRIDGE_PORT: '1' }, { fetchLatestVersion });
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain(`Option --${name} given more than once`);
    expect(fetchLatestVersion).not.toHaveBeenCalled();
    expect(existsSync(result.io.homeDir)).toBe(false);
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

  // Codex still scans its deprecated `$CODEX_HOME/skills` (default `~/.codex`)
  // besides `~/.agents/skills` and lists a same-name skill from both; cc-switch
  // links a copy in there. install-skill and setup refresh a copy they find
  // there, after the `.agents` one, and never create one. With a copy there
  // and none in `.agents`, they create no `.agents` copy either.
  describe('with a copy in the legacy Codex root', () => {
    const OLD = '---\nname: favbase\n---\nolder\n';

    /** An OLD copy at `<parent>/skills/favbase/SKILL.md`: a Codex home's shape, and `.agents`'. */
    async function seedCopy(parent: string): Promise<string> {
      const dir = join(parent, 'skills', 'favbase');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), OLD);
      return join(dir, 'SKILL.md');
    }

    const claudeCopy = (homeDir: string) => join(homeDir, '.claude', 'skills', 'favbase', 'SKILL.md');
    const agentsCopy = (homeDir: string) => join(homeDir, '.agents', 'skills', 'favbase', 'SKILL.md');

    it.each([
      [['install-skill', '--agent', 'codex'], false],
      [['install-skill', '--agent', 'all'], true],
      [['install-skill'], true],
      [['setup', '--token', 'abc'], true],
    ])('%j rewrites it and creates no .agents copy beside it', async (argv, withClaude) => {
      const homeDir = await userHome();
      const legacy = await seedCopy(join(homeDir, '.codex'));
      const result = await run(argv, {}, { homeDir });
      expect(result.code).toBe(EXIT_OK);

      const output = JSON.parse(result.stdout) as { installed?: string[]; skills?: string[] };
      expect(output.installed ?? output.skills).toEqual([
        ...(withClaude ? [claudeCopy(homeDir)] : []),
        legacy,
      ]);
      await expect(readFile(legacy, 'utf8')).resolves.toBe(SKILL);
      expect(existsSync(join(homeDir, '.agents'))).toBe(false);
    });

    it('rewrites it after the .agents copy when both are there', async () => {
      const homeDir = await userHome();
      const legacy = await seedCopy(join(homeDir, '.codex'));
      const agents = await seedCopy(join(homeDir, '.agents'));

      const result = await run(['install-skill', '--agent', 'codex'], {}, { homeDir });
      expect(JSON.parse(result.stdout)).toEqual({ installed: [agentsCopy(homeDir), legacy] });
      await expect(readFile(agents, 'utf8')).resolves.toBe(SKILL);
      await expect(readFile(legacy, 'utf8')).resolves.toBe(SKILL);
    });

    it('leaves it alone for --agent claude and for --dir', async () => {
      const homeDir = await userHome();
      const legacy = await seedCopy(join(homeDir, '.codex'));

      const claude = await run(['install-skill', '--agent', 'claude'], {}, { homeDir });
      expect(JSON.parse(claude.stdout)).toEqual({ installed: [claudeCopy(homeDir)] });
      const dir = join(homeDir, 'custom');
      const custom = await run(['install-skill', '--dir', dir], {}, { homeDir });
      expect(JSON.parse(custom.stdout)).toEqual({ installed: [join(dir, 'favbase', 'SKILL.md')] });

      await expect(readFile(legacy, 'utf8')).resolves.toBe(OLD);
    });

    it('follows CODEX_HOME instead of <home>/.codex', async () => {
      const homeDir = await userHome();
      const codexHome = join(homeDir, '..', 'codex-home');
      const legacy = await seedCopy(codexHome);
      const decoy = await seedCopy(join(homeDir, '.codex'));

      const result = await run(['install-skill', '--agent', 'codex'], { CODEX_HOME: codexHome }, { homeDir });
      expect(JSON.parse(result.stdout)).toEqual({ installed: [legacy] });
      await expect(readFile(legacy, 'utf8')).resolves.toBe(SKILL);
      await expect(readFile(decoy, 'utf8')).resolves.toBe(OLD);
      expect(existsSync(join(homeDir, '.agents'))).toBe(false);
    });

    it('does not create one when there is none', async () => {
      const homeDir = await userHome();
      const result = await run(['install-skill', '--agent', 'codex'], {}, { homeDir });
      expect(JSON.parse(result.stdout)).toEqual({ installed: [agentsCopy(homeDir)] });
      expect(existsSync(join(homeDir, '.codex'))).toBe(false);
    });
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

// SKILL.md's exit table is the agent's error handling (silent-failure guide,
// Gotcha 5). A file favbase could not write used to fall through to exit 2,
// "run favbase doctor", and doctor checks no file favbase writes. Exit 1
// without the usage line tells the agent to show the user the message, and the
// message names the path. The fake daemon sits where a data command would
// look for one: none of these commands may reach it.
describe('a local file favbase cannot write', () => {
  const claudeCopy = (homeDir: string) => join(homeDir, '.claude', 'skills', 'favbase', 'SKILL.md');

  // A file where the skill directory goes fails `installSkill`'s mkdir; a
  // directory where SKILL.md goes passes `refreshSkill`'s stat, then fails its
  // write. Both portable, no permissions involved.
  const blockers: [string, (homeDir: string) => Promise<void>][] = [
    ['a file where the skill directory goes', async (homeDir) => {
      await mkdir(join(homeDir, '.claude', 'skills'), { recursive: true });
      await writeFile(join(homeDir, '.claude', 'skills', 'favbase'), 'not a directory');
    }],
    ['a directory where SKILL.md goes', async (homeDir) => {
      await mkdir(claudeCopy(homeDir), { recursive: true });
    }],
  ];

  /** One stderr line naming `path` and the OS reason; nothing on stdout. */
  function expectCannotWrite(result: Run, path: string): void {
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stdout).toBe('');
    const lines = result.stderr.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^favbase: cannot write .+: E[A-Z]+: /);
    expect(lines[0].startsWith(`favbase: cannot write ${path}: `)).toBe(true);
    expect(result.stderr).not.toContain('Run favbase --help');
  }

  it.each(blockers)('install-skill names the skill copy: %s', async (_name, block) => {
    const homeDir = await userHome();
    await block(homeDir);
    const daemon = await fakeDaemon();

    const result = await run(['install-skill', '--agent', 'claude'], daemon.env, { homeDir });

    expectCannotWrite(result, claudeCopy(homeDir));
    expect(daemon.requests).toEqual([]);
  });

  it.each(blockers)('setup writes the config, then names the skill copy: %s', async (_name, block) => {
    const homeDir = await userHome();
    await block(homeDir);
    const daemon = await fakeDaemon();
    const port = Number(daemon.env.FAVBASE_BRIDGE_PORT);

    const result = await run(['setup', '--token', 'abc', '--port', String(port)], {}, { homeDir });

    expectCannotWrite(result, claudeCopy(homeDir));
    expect(JSON.parse(await readFile(configPath(result.io.env), 'utf8'))).toEqual({ token: 'abc', port });
    expect(daemon.requests).toEqual([]);
  });

  // Read-only, so `readConfigFile` still succeeds and the failure is the write
  // itself (a FAVBASE_HOME that is a file fails the read first on POSIX).
  it('setup names a config file it cannot write', async (ctx) => {
    const homeDir = await userHome();
    const env = { FAVBASE_HOME: join(homeDir, '..', 'favbase') };
    const path = configPath(env);
    await mkdir(favbaseHome(env), { recursive: true });
    await writeFile(path, JSON.stringify({ token: 'old', port: 2222 }));
    await chmod(path, 0o444);
    if (await access(path, constants.W_OK).then(() => true, () => false)) {
      ctx.skip('a read-only file is still writable here (running as root?)');
    }
    const daemon = await fakeDaemon();

    const result = await run(['setup', '--token', 'abc', '--no-skill'], { ...daemon.env, ...env }, { homeDir });

    expectCannotWrite(result, path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ token: 'old', port: 2222 });
    expect(daemon.requests).toEqual([]);
  });
});

// Windows PowerShell 5.1 does not escape embedded double quotes when it builds
// a native command line, so `call --args '{"platform":"zhihu"}'` reaches node
// as `{platform:zhihu}`. A path survives every shell; `--args-file` carries one.
describe('favbase call arguments', () => {
  // A space, a number and non-ASCII text: the three things a quote-stripped
  // `--args` cannot carry, and the last one what a non-UTF-8 read would mangle.
  const ARGS = { query: 'rust async \u5f02\u6b65', top_k: 3 };
  const FILE_FORM = '--args-file <path>';

  async function scratchDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'favbase-args-'));
    temps.push(dir);
    return dir;
  }

  async function argsFile(content: string | Buffer): Promise<string> {
    const file = join(await scratchDir(), 'args.json');
    await writeFile(file, content);
    return file;
  }

  it.each([
    ['inline --args', async () => ['--args', JSON.stringify(ARGS)]],
    ['--args-file', async () => ['--args-file', await argsFile(JSON.stringify(ARGS))]],
    [
      '--args-file relative to the working directory',
      async () => ['--args-file', relative(process.cwd(), await argsFile(JSON.stringify(ARGS)))],
    ],
    // What Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes.
    ['--args-file with a UTF-8 BOM', async () => ['--args-file', await argsFile(`\uFEFF${JSON.stringify(ARGS)}`)]],
  ])('hands the tool the same object from %s', async (_name, flags) => {
    const daemon = await fakeDaemon();
    const result = await run(['call', 'searchKnowledgeBase', ...(await flags())], daemon.env);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(EXIT_OK);
    expect(daemon.calls).toEqual([{ tool: 'searchKnowledgeBase', args: ARGS }]);
    expect(JSON.parse(result.stdout)).toEqual({ answered: true });
  });

  it.each([
    ['an array', '[1]'],
    ['null', 'null'],
    ['JSON that lost its quotes', '{platform:zhihu}'],
    ['nothing', ''],
  ])('refuses a file holding %s before touching the daemon', async (_name, content) => {
    const daemon = await fakeDaemon();
    const result = await run(['call', 'getProcessingCoverage', '--args-file', await argsFile(content)], daemon.env);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('--args-file must contain a JSON object');
    // The quotes were not the problem here, so no PowerShell advice.
    expect(result.stderr).not.toContain('PowerShell');
    expect(daemon.requests).toEqual([]);
  });

  // UTF-16 is what Windows PowerShell 5.1's `>` and `Out-File` write by
  // default, and `Set-Content` writes the ANSI code page (GBK where that is
  // code page 936). Read leniently, UTF-16 is blamed on the JSON, and the GBK
  // bytes for the query decode to U+FFFD plus a Hangul syllable and still
  // parse -- the search would run on noise.
  it.each([
    ['a missing file', async () => join(await scratchDir(), 'missing.json'), 'ENOENT'],
    ['a UTF-16 file', async () => argsFile(Buffer.from(`\uFEFF${JSON.stringify(ARGS)}`, 'utf16le')), 'utf-8'],
    [
      'a GBK file',
      async () => argsFile(Buffer.concat([
        Buffer.from('{"query":"'),
        Buffer.from([0xd2, 0xec, 0xb2, 0xbd]),
        Buffer.from('"}'),
      ])),
      'utf-8',
    ],
  ])('refuses %s, naming it, before touching the daemon', async (_name, makePath, detail) => {
    const daemon = await fakeDaemon();
    const path = await makePath();
    const result = await run(['call', 'searchKnowledgeBase', '--args-file', path], daemon.env);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain(`cannot read --args-file ${path}`);
    expect(result.stderr).toContain(detail);
    expect(daemon.requests).toEqual([]);
  });

  it('refuses --args together with --args-file', async () => {
    const daemon = await fakeDaemon();
    const file = await argsFile(JSON.stringify(ARGS));
    const result = await run(
      ['call', 'searchKnowledgeBase', '--args', JSON.stringify(ARGS), '--args-file', file],
      daemon.env,
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stderr).toContain('--args or --args-file, not both');
    expect(daemon.requests).toEqual([]);
  });

  // `{platform:zhihu}` is exactly what node receives from Windows PowerShell
  // 5.1 for `--args '{"platform":"zhihu"}'`. The error is where a user or an
  // agent learns the way around it, so it has to name the form the docs teach.
  it('points a failed --args at --args-file, the form SKILL.md and the README teach', async () => {
    const daemon = await fakeDaemon();
    const result = await run(['call', 'getProcessingCoverage', '--args', '{platform:zhihu}'], daemon.env);
    expect(result.code).toBe(EXIT_USAGE);
    const [line] = result.stderr.split('\n');
    expect(line).toContain('--args must be a JSON object');
    expect(line).toContain('Windows PowerShell 5.1');
    expect(line).toContain(FILE_FORM);
    expect(daemon.requests).toEqual([]);

    for (const doc of ['../../skills/favbase/SKILL.md', './README.md']) {
      const text = readFileSync(new URL(doc, import.meta.url), 'utf8');
      expect(text, `${doc} no longer teaches ${FILE_FORM}`).toContain(FILE_FORM);
    }
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
    [['call', 'listTags', '--args-file', 'no-such-args-file.json']],
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
