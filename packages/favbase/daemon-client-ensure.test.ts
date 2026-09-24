import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedConfig } from './config';

// ensureDaemon calls fetchHealth/stopDaemon inside its own module, where
// vi.mock cannot reach. So both run for real against loopback fake daemons,
// and only the process spawn is mocked: "spawning" starts the next fake on the
// same port, the way a real `daemon run` would take it over.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { ensureDaemon, type EnsureDaemonOptions } from './daemon-client';

const TOKEN = 'ensure-daemon-test-token';
// Only signalled after a 401 from /shutdown, which no fake here returns.
const FAKE_PID = 2_147_483_000;

interface FakeDaemon {
  server: Server;
  port: number;
  shutdowns: number;
}

const servers: Server[] = [];
const temps: string[] = [];
let nextDaemon: { port: number; version: string } | null = null;

interface FakeBehaviour {
  /**
   * `exit` answers /shutdown and closes; `reset-and-exit` is a daemon already
   * on its way out (another CLI's shutdown got there first): it resets the
   * request and closes; `stall` never answers and never exits.
   */
  onShutdown?: 'exit' | 'reset-and-exit' | 'stall';
  /** Reset this many /health probes first, the way a closing daemon does. */
  resetHealthProbes?: number;
  /** Report this after the first /health answer: someone replaced it meanwhile. */
  laterHealth?: { version: string; pid: number };
}

async function fakeDaemon(
  port: number,
  version: string,
  behaviour: FakeBehaviour = {},
): Promise<FakeDaemon> {
  const { onShutdown = 'exit', laterHealth } = behaviour;
  let resets = behaviour.resetHealthProbes ?? 0;
  let answered = 0;
  const fake = { shutdowns: 0 } as FakeDaemon;
  const close = () => {
    server.close();
    server.closeAllConnections();
  };
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      if (resets > 0) {
        resets -= 1;
        request.socket.destroy();
        return;
      }
      const health = answered > 0 && laterHealth ? laterHealth : { version, pid: FAKE_PID };
      answered += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'favbase', ...health }));
      return;
    }
    if (request.url === '/shutdown' && request.method === 'POST') {
      fake.shutdowns += 1;
      if (onShutdown === 'stall') return;
      if (onShutdown === 'reset-and-exit') {
        request.socket.destroy();
        close();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }), close);
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake daemon did not listen');
  return Object.assign(fake, { server, port: address.port });
}

async function freePort(): Promise<number> {
  const probe = await fakeDaemon(0, 'probe');
  await new Promise<void>((resolve) => probe.server.close(() => resolve()));
  return probe.port;
}

function config(port: number): ResolvedConfig {
  return { token: TOKEN, port, tokenSource: 'env', portSource: 'env', configPath: 'unused' };
}

async function options(cliVersion: string, logs: string[] = []): Promise<EnsureDaemonOptions> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-ensure-'));
  temps.push(home);
  return {
    cliPath: join(home, 'never-spawned.js'),
    env: { FAVBASE_HOME: home },
    cliVersion,
    log: (line) => logs.push(line),
  };
}

beforeEach(() => {
  nextDaemon = null;
  spawnMock.mockReset().mockImplementation(() => {
    if (nextDaemon) void fakeDaemon(nextDaemon.port, nextDaemon.version);
    return { pid: 4242, unref: () => undefined };
  });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('ensureDaemon version handling (docs/27 Step 2, L2)', () => {
  it('stops a daemon older than this CLI and starts its own', async () => {
    const old = await fakeDaemon(0, '0.1.0');
    nextDaemon = { port: old.port, version: '0.2.0' };
    const logs: string[] = [];

    const result = await ensureDaemon(config(old.port), await options('0.2.0', logs));

    expect(result).toEqual({
      health: { name: 'favbase', version: '0.2.0', pid: FAKE_PID },
      spawned: true,
      replaced: { from: '0.1.0', to: '0.2.0' },
    });
    expect(old.shutdowns).toBe(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(logs.find(line => line.includes('replacing daemon'))).toMatch(/0\.1\.0.*0\.2\.0/);
  });

  // Newest wins: two installed CLIs never take turns restarting the daemon.
  // Anything that is not a plain release (dev build, test fixture) is kept.
  it.each([
    ['newer than this CLI', '0.3.0', '0.2.0'],
    ['equal to this CLI', '0.2.0', '0.2.0'],
    ['not a release', 'test', '0.2.0'],
    ['older, but this CLI is a dev build', '0.1.0', '0.0.0-dev'],
  ])('keeps a running daemon whose version is %s', async (_label, daemonVersion, cliVersion) => {
    const daemon = await fakeDaemon(0, daemonVersion);

    const result = await ensureDaemon(config(daemon.port), await options(cliVersion));

    expect(result).toEqual({
      health: { name: 'favbase', version: daemonVersion, pid: FAKE_PID },
      spawned: false,
      replaced: null,
    });
    expect(daemon.shutdowns).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('starts a daemon when none is running, with nothing to replace', async () => {
    const port = await freePort();
    nextDaemon = { port, version: '0.2.0' };

    const result = await ensureDaemon(config(port), await options('0.2.0'));

    expect(result).toMatchObject({ spawned: true, replaced: null, health: { version: '0.2.0' } });
  });

  // Falling back to the old daemon would hide the failure and keep serving
  // old code; the error surfaces instead, naming both versions.
  it('surfaces a failed stop instead of keeping the old daemon', async () => {
    const old = await fakeDaemon(0, '0.1.0', { onShutdown: 'stall' });

    await expect(ensureDaemon(config(old.port), await options('0.2.0'))).rejects.toMatchObject({
      name: 'DaemonError',
      code: 'unreachable',
      message: expect.stringContaining('could not stop the older favbase daemon 0.1.0'),
    });
    expect(old.shutdowns).toBe(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// Parallel commands right after an upgrade all find the same older daemon, and
// the first one's shutdown pulls it away from under the others. Measured on
// real processes (4-8 parallel `daemon start` against an older daemon), each
// of these failed some runs with exit 2 before it was handled.
describe('ensureDaemon while another CLI is replacing the same daemon', () => {
  it('treats a shutdown request reset by a daemon already on its way out as stopped', async () => {
    const old = await fakeDaemon(0, '0.1.0', { onShutdown: 'reset-and-exit' });
    nextDaemon = { port: old.port, version: '0.2.0' };

    const result = await ensureDaemon(config(old.port), await options('0.2.0'));

    expect(result).toMatchObject({ spawned: true, replaced: { from: '0.1.0', to: '0.2.0' } });
    expect(result.health.version).toBe('0.2.0');
  });

  // Was reported as "served by something that is not the favbase daemon;
  // pick another port" -- advice that sends the user to reconfigure.
  it('looks again when a health probe is reset instead of calling the port foreign', async () => {
    const daemon = await fakeDaemon(0, '0.2.0', { resetHealthProbes: 1 });

    const result = await ensureDaemon(config(daemon.port), await options('0.2.0'));

    expect(result).toMatchObject({ spawned: false, replaced: null, health: { version: '0.2.0' } });
  });

  it('still calls a port foreign when every probe is reset', async () => {
    const daemon = await fakeDaemon(0, '0.2.0', { resetHealthProbes: 2 });

    await expect(ensureDaemon(config(daemon.port), await options('0.2.0')))
      .rejects.toMatchObject({ code: 'foreign' });
  });

  it('does not stop a daemon that a parallel command started in the meantime', async () => {
    const replacedMeanwhile = { version: '0.2.0', pid: FAKE_PID + 1 };
    const daemon = await fakeDaemon(0, '0.1.0', { laterHealth: replacedMeanwhile });

    const result = await ensureDaemon(config(daemon.port), await options('0.2.0'));

    expect(daemon.shutdowns).toBe(0);
    expect(result.health).toEqual({ name: 'favbase', ...replacedMeanwhile });
  });
});
