import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocket, type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
  type JsonObject,
} from '../../lib/agent-bridge/protocol';

const CLI_PATH = fileURLToPath(new URL('./dist/cli.js', import.meta.url));
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'integration-test-token';
const TOOL: AgentBridgeToolDescriptor = {
  name: 'searchKnowledgeBase',
  description: 'Search saved content',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { query: { type: 'string' }, top_k: { type: 'integer' } },
    required: ['query'],
  },
};

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

const sockets: WebSocket[] = [];
const children: ChildProcess[] = [];
const homes: string[] = [];
const daemonPorts: number[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  // Detached daemons outlive the test process; ask each one to exit.
  await Promise.all(daemonPorts.splice(0).map(port => shutdownDaemon(port)));
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
});

async function freePort(): Promise<number> {
  const { createServer: createTcpServer } = await import('node:net');
  const server = createTcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'favbase-integration-'));
  homes.push(home);
  return home;
}

function cliEnv(port: number, home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FAVBASE_BRIDGE_PORT: String(port),
    FAVBASE_TOKEN: TOKEN,
    FAVBASE_HOME: home,
    FAVBASE_DAEMON_IDLE_MINUTES: '0',
    ...extra,
  };
}

function spawnCli(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function collect(child: ChildProcess): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout?.on('data', chunk => stdout.push(String(chunk)));
  child.stderr?.on('data', chunk => stderr.push(String(chunk)));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CLI did not exit: ${stderr.join('')}`)), 20_000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  return collect(spawnCli(args, env));
}

async function startDaemonProcess(port: number, home: string): Promise<ChildProcess> {
  const child = spawnCli(['daemon', 'run'], cliEnv(port, home));
  daemonPorts.push(port);
  const stderr: string[] = [];
  child.stderr?.on('data', chunk => stderr.push(String(chunk)));
  const deadline = Date.now() + 10_000;
  while (!stderr.join('').includes('listening on')) {
    if (child.exitCode !== null) throw new Error(`daemon exited early: ${stderr.join('')}`);
    if (Date.now() >= deadline) throw new Error(`daemon did not start: ${stderr.join('')}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return child;
}

function shutdownDaemon(port: number): Promise<void> {
  return new Promise((resolve) => {
    const clientRequest = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/shutdown',
        headers: { authorization: `Bearer ${TOKEN}` },
        timeout: 2_000,
      },
      (response) => {
        response.resume();
        response.once('end', resolve);
      },
    );
    clientRequest.once('error', () => resolve());
    clientRequest.once('timeout', () => {
      clientRequest.destroy();
      resolve();
    });
    clientRequest.end();
  });
}

async function connectExtension(port: number, attempts = 1): Promise<WebSocket> {
  for (let attempt = 1; ; attempt += 1) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {
      origin: `chrome-extension://${EXTENSION_ID}`,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      sockets.push(socket);
      return socket;
    } catch (error) {
      socket.terminate();
      if (attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

function send(socket: WebSocket, input: AgentBridgeMessageInput): void {
  const message = encodeAgentBridgeMessage(input);
  if (!message) throw new Error('Invalid Agent Bridge test message');
  socket.send(JSON.stringify(message));
}

function nextMessage(socket: WebSocket, timeoutMs = 5_000): Promise<AgentBridgeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Agent Bridge message'));
    }, timeoutMs);
    const onMessage = (data: RawData) => {
      const message = decodeAgentBridgeMessage(JSON.parse(data.toString()));
      cleanup();
      if (message) resolve(message);
      else reject(new Error('Received invalid Agent Bridge message'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed before the expected message'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    };
    socket.once('message', onMessage);
    socket.once('close', onClose);
  });
}

async function helloAsExtension(socket: WebSocket, token = TOKEN): Promise<AgentBridgeMessage> {
  const reply = nextMessage(socket);
  send(socket, {
    id: 'hello-1',
    type: 'hello',
    payload: { token, extensionId: EXTENSION_ID, extensionVersion: '0.0.5', tools: [TOOL] },
  });
  return reply;
}

/** Answers the next forwarded tools.call with `result` and returns the call payload. */
async function answerNextCall(
  socket: WebSocket,
  result: JsonObject,
): Promise<{ name: string; args: JsonObject }> {
  const message = await nextMessage(socket, 15_000);
  if (message.type !== 'tools.call') throw new Error(`Expected tools.call, received ${message.type}`);
  send(socket, {
    id: 'result-1',
    type: 'tools.result',
    payload: { callId: message.payload.callId, ok: true, result },
  });
  return { name: message.payload.name, args: message.payload.args };
}

async function expectUpgradeRejected(
  port: number,
  path: string,
  origin: string,
  statusCode: number,
): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
  await new Promise<void>((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      socket.once('error', () => undefined);
      socket.once('close', () => {
        if (response.statusCode === statusCode) resolve();
        else reject(new Error(`Expected HTTP ${statusCode}, received ${response.statusCode}`));
      });
      socket.terminate();
    });
    socket.once('open', () => reject(new Error('Unexpected WebSocket connection')));
  });
}

describe('favbase CLI process integration', () => {
  it('runs search and tools against a foreground daemon paired with a fake extension', async () => {
    const port = await freePort();
    const home = await tempHome();
    await startDaemonProcess(port, home);
    const extension = await connectExtension(port);
    await expect(helloAsExtension(extension)).resolves.toMatchObject({
      type: 'welcome',
      payload: { token: TOKEN },
    });

    const answered = answerNextCall(extension, { count: 1, results: [] });
    const search = await runCli(['search', 'favbase', '--limit', '3'], cliEnv(port, home));
    await expect(answered).resolves.toEqual({
      name: TOOL.name,
      args: { query: 'favbase', top_k: 3 },
    });
    expect(search.code).toBe(0);
    expect(JSON.parse(search.stdout)).toEqual({ count: 1, results: [] });
    expect(search.stderr).toBe('');

    const tools = await runCli(['tools'], cliEnv(port, home));
    expect(tools.code).toBe(0);
    expect(JSON.parse(tools.stdout)).toEqual([TOOL]);

    const doctor = await runCli(['doctor'], cliEnv(port, home));
    expect(doctor.code).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      ok: true,
      config: { port, tokenSource: 'env', portSource: 'env' },
      daemon: { name: 'favbase-cli', spawned: false },
      extension: { connected: true, extensionId: EXTENSION_ID },
    });
  });

  it('starts a background daemon on first use and stops it on request', async () => {
    const port = await freePort();
    const home = await tempHome();
    daemonPorts.push(port);

    const tags = collect(spawnCli(['tags'], cliEnv(port, home)));
    const extension = await connectExtension(port, 100);
    await expect(helloAsExtension(extension)).resolves.toMatchObject({ type: 'welcome' });
    await expect(answerNextCall(extension, { count: 0, tags: [] })).resolves.toEqual({
      name: 'listTags',
      args: {},
    });
    const result = await tags;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ count: 0, tags: [] });
    expect(result.stderr).toContain('starting daemon');

    const stop = await runCli(['daemon', 'stop'], cliEnv(port, home));
    expect(stop.code).toBe(0);
    expect(JSON.parse(stop.stdout)).toEqual({ port, daemon: 'stopped' });
    await expect(runCli(['daemon', 'stop'], cliEnv(port, home))).resolves.toMatchObject({
      stdout: expect.stringContaining('not-running'),
    });
  });

  it('rejects a fake extension with the wrong Bridge Token', async () => {
    const port = await freePort();
    await startDaemonProcess(port, await tempHome());
    const extension = await connectExtension(port);

    await expect(helloAsExtension(extension, 'wrong-token')).resolves.toMatchObject({
      type: 'reject',
      payload: { reason: 'bad-token' },
    });
    await once(extension, 'close');
  });

  it('rejects WebSocket upgrades outside the bridge path and from non-extension origins', async () => {
    const port = await freePort();
    await startDaemonProcess(port, await tempHome());
    await expectUpgradeRejected(port, '/not-the-bridge', `chrome-extension://${EXTENSION_ID}`, 400);
    await expectUpgradeRejected(port, '/bridge', 'http://127.0.0.1', 403);
  });

  it('fails fast when the port belongs to a program that is not the daemon', async () => {
    const port = await freePort();
    const foreign = createServer((_request, response) => response.end('hello'));
    foreign.listen(port, '127.0.0.1');
    await once(foreign, 'listening');
    try {
      const result = await runCli(['tags'], cliEnv(port, await tempHome()));
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('not the favbase daemon');
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });

  it('exits a second foreground daemon with code 1 when the port is occupied', async () => {
    const port = await freePort();
    const home = await tempHome();
    await startDaemonProcess(port, home);

    const second = await runCli(['daemon', 'run'], cliEnv(port, home));
    expect(second.code).toBe(1);
    expect(second.stderr).toContain(`port ${port} is already in use`);
  });

  it('refuses to run data commands without a token and prints the setup hint', async () => {
    const port = await freePort();
    const env = cliEnv(port, await tempHome());
    delete env.FAVBASE_TOKEN;
    const result = await runCli(['search', 'x'], env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('favbase setup --token');
  });
});
