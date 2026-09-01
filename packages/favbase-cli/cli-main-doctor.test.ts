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
  EXIT_UNAVAILABLE,
  EXTENSION_LATENCY_HINT,
  formatDaemonLogLine,
  main,
  type CliIo,
} from './cli-main';

const TOKEN = 'doctor-test-token';
const temps: string[] = [];

beforeEach(() => {
  daemonMocks.ensureDaemon.mockReset().mockResolvedValue({
    health: { name: 'favbase-cli', version: 'test', pid: 123 },
    spawned: false,
  });
  daemonMocks.fetchStatus.mockReset().mockResolvedValue({
    ok: true,
    daemon: {
      name: 'favbase-cli',
      version: 'test',
      pid: 123,
      port: 17_836,
      startedAt: 1,
      idleMinutes: 120,
    },
    extension: {
      connected: false,
      extensionId: null,
      tools: [],
      rejectedHelloCount: 3,
      lastRejectedHelloAt: Date.parse('2026-09-01T12:34:56.000Z'),
      lastRejectedHelloReason: 'bad-token',
    },
  });
});

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function runDoctor(): Promise<{ code: number; stdout: string; stderr: string }> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-doctor-'));
  temps.push(home);
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    env: {
      FAVBASE_HOME: join(home, 'favbase'),
      FAVBASE_TOKEN: TOKEN,
      FAVBASE_BRIDGE_PORT: '17836',
    },
    cliPath: join(home, 'cli.js'),
    homeDir: home,
    skillContent: '',
    version: 'test',
    stdout: text => { stdout += text; },
    stderr: text => { stderr += text; },
  };
  return { code: await main(['doctor'], io), stdout, stderr };
}

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
    expect(output.troubleshooting.join(' ')).toContain('Bridge Token');
    expect(output.troubleshooting.join(' ')).toContain('Agent Bridge is enabled');
    expect(output.troubleshooting.join(' ')).toContain('Chrome is running');
    expect(output.troubleshooting.join(' ')).toContain('17836');
    expect(output.troubleshooting.join(' ')).toContain('daemon.log');
    expect(result.stderr).toContain(EXTENSION_LATENCY_HINT);
    expect(result.stdout).not.toContain(TOKEN);
    expect(result.stderr).not.toContain(TOKEN);
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
