import { once } from 'node:events';
import { request } from 'node:http';

import { WebSocket, type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
} from '../../lib/agent-bridge/protocol';
import { Daemon } from './daemon';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'daemon-test-token';
const TOOL: AgentBridgeToolDescriptor = {
  name: 'searchKnowledgeBase',
  description: 'Search saved content',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
};

const daemons: Daemon[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(daemons.splice(0).map(daemon => daemon.close()));
});

async function startDaemon(options: { idleMinutes?: number; helloWaitMs?: number } = {}): Promise<{ daemon: Daemon; port: number }> {
  const daemon = new Daemon({
    port: 0,
    token: TOKEN,
    version: 'test',
    idleMinutes: options.idleMinutes ?? 0,
    helloWaitMs: options.helloWaitMs ?? 5_000,
    logger: { error: () => undefined },
  });
  daemons.push(daemon);
  await daemon.start();
  const port = daemon.port;
  if (port === null) throw new Error('daemon did not listen');
  return { daemon, port };
}

async function connectExtension(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {
    origin: `chrome-extension://${EXTENSION_ID}`,
  });
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}

function send(socket: WebSocket, input: AgentBridgeMessageInput): void {
  const message = encodeAgentBridgeMessage(input);
  if (!message) throw new Error('invalid test message');
  socket.send(JSON.stringify(message));
}

function nextMessage(socket: WebSocket): Promise<AgentBridgeMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: RawData) => {
      const message = decodeAgentBridgeMessage(JSON.parse(data.toString()));
      if (message) resolve(message);
      else reject(new Error('invalid Agent Bridge message'));
    });
  });
}

async function hello(socket: WebSocket): Promise<void> {
  const welcome = nextMessage(socket);
  send(socket, {
    id: 'hello-1',
    type: 'hello',
    payload: { token: TOKEN, extensionId: EXTENSION_ID, extensionVersion: '0.0.5', tools: [TOOL] },
  });
  await expect(welcome).resolves.toMatchObject({ type: 'welcome', payload: { token: TOKEN } });
}

function http(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const clientRequest = request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) : null });
      });
    });
    clientRequest.once('error', reject);
    if (payload !== undefined) clientRequest.write(payload);
    clientRequest.end();
  });
}

describe('Daemon', () => {
  it('serves the extension WebSocket and the CLI HTTP routes on one port', async () => {
    const { port } = await startDaemon();
    const extension = await connectExtension(port);
    await hello(extension);

    await expect(http(port, 'GET', '/status')).resolves.toMatchObject({
      status: 200,
      body: { extension: { connected: true, extensionId: EXTENSION_ID, tools: [TOOL] } },
    });

    const forwarded = nextMessage(extension);
    const call = http(port, 'POST', '/rpc', { tool: TOOL.name, args: { query: 'favbase' } });
    const message = await forwarded;
    expect(message).toMatchObject({ type: 'tools.call', payload: { name: TOOL.name, args: { query: 'favbase' } } });
    if (message.type !== 'tools.call') throw new Error('expected tools.call');
    send(extension, {
      id: 'result-1',
      type: 'tools.result',
      payload: { callId: message.payload.callId, ok: true, result: { count: 1 } },
    });
    await expect(call).resolves.toMatchObject({ status: 200, body: { ok: true, result: { count: 1 } } });
  });

  it('answers a waited status as disconnected once the hello deadline passes', async () => {
    const { port } = await startDaemon({ helloWaitMs: 50 });
    await expect(http(port, 'GET', '/status?wait=1')).resolves.toMatchObject({
      status: 200,
      body: { extension: { connected: false } },
    });
    await expect(http(port, 'POST', '/rpc', { tool: TOOL.name, args: { query: 'x' } })).resolves.toMatchObject({
      body: { ok: false, code: 'extension-unavailable' },
    });
  });

  it('exits after the idle deadline and on /shutdown', async () => {
    const idle = await startDaemon({ idleMinutes: 0.001 });
    await expect(idle.daemon.whenClosed()).resolves.toBeUndefined();
    await expect(http(idle.port, 'GET', '/health')).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    const { daemon, port } = await startDaemon();
    await expect(http(port, 'POST', '/shutdown')).resolves.toMatchObject({ body: { ok: true } });
    await expect(daemon.whenClosed()).resolves.toBeUndefined();
  });
});
