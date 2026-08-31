import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EXIT_OK, EXIT_USAGE, main, type CliIo } from './cli-main';
import { configPath } from './config';

const SKILL = '---\nname: favbase\n---\nbody\n';
const temps: string[] = [];

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  io: CliIo;
}

async function run(argv: string[], env: Record<string, string> = {}): Promise<Run> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-cli-'));
  temps.push(home);
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    env: { FAVBASE_HOME: join(home, 'favbase'), ...env },
    cliPath: join(home, 'never-spawned.js'),
    homeDir: join(home, 'user'),
    skillContent: SKILL,
    version: '9.9.9',
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
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
});
