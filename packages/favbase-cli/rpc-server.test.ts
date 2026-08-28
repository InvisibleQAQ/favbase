import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentBridgeToolDescriptor,
  JsonObject,
  JsonValue,
} from '../../lib/agent-bridge/protocol';
import { BridgeCallError, type BridgePeerSnapshot } from './bridge-server';
import {
  createRpcHandler,
  DAEMON_NAME,
  type RpcHandlerOptions,
  type RpcPeer,
} from './rpc-server';

const TOKEN = 'rpc-test-token';
const TOOL: AgentBridgeToolDescriptor = {
  name: 'listTags',
  description: 'List tags',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {},
  },
};

class FakePeer implements RpcPeer {
  connected = false;
  calls: Array<{ name: string; args: JsonObject }> = [];
  nextResult: JsonValue | BridgeCallError = { count: 0 };

  async callTool(name: string, args: JsonObject): Promise<JsonValue> {
    this.calls.push({ name, args });
    if (this.nextResult instanceof BridgeCallError) throw this.nextResult;
    return this.nextResult;
  }

  async listTools(): Promise<readonly AgentBridgeToolDescriptor[]> {
    if (!this.connected) throw new BridgeCallError('extension-unavailable', 'no hello');
    return [TOOL];
  }

  peerSnapshot(): BridgePeerSnapshot {
    return this.connected
      ? { connected: true, extensionId: 'ext', tools: [TOOL] }
      : { connected: false, extensionId: null, tools: [] };
  }
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function startServer(
  peer: RpcPeer,
  overrides: Partial<RpcHandlerOptions> = {},
): Promise<{ port: number; onActivity: ReturnType<typeof vi.fn>; onShutdown: ReturnType<typeof vi.fn> }> {
  const onActivity = vi.fn();
  const onShutdown = vi.fn();
  const server = createServer(createRpcHandler({
    token: TOKEN,
    version: 'test',
    port: 0,
    startedAt: 1,
    idleMinutes: 0,
    peer,
    onActivity,
    onShutdown,
    ...overrides,
  }));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { port: address.port, onActivity, onShutdown };
}

interface CallOptions {
  token?: string;
  body?: string;
  headers?: Record<string, string>;
}

function call(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const clientRequest = request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    clientRequest.once('error', reject);
    if (options.body !== undefined) clientRequest.write(options.body);
    clientRequest.end();
  });
}

describe('createRpcHandler', () => {
  it('answers /health without authentication and identifies the daemon', async () => {
    const { port } = await startServer(new FakePeer());
    await expect(call(port, 'GET', '/health')).resolves.toMatchObject({
      status: 200,
      body: { name: DAEMON_NAME, version: 'test', pid: process.pid },
    });
  });

  it('rejects any request carrying an Origin header before authentication', async () => {
    const { port, onActivity } = await startServer(new FakePeer());
    const result = await call(port, 'GET', '/health', {
      token: TOKEN,
      headers: { origin: 'http://evil.example' },
    });
    expect(result.status).toBe(403);
    expect(onActivity).not.toHaveBeenCalled();
  });

  it('requires the exact Bridge Token on every non-health route', async () => {
    const { port, onActivity } = await startServer(new FakePeer());
    const missing = await call(port, 'GET', '/status');
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect((await call(port, 'GET', '/status', { token: 'wrong' })).status).toBe(401);
    expect((await call(port, 'POST', '/rpc', { body: '{}' })).status).toBe(401);
    expect((await call(port, 'POST', '/shutdown')).status).toBe(401);
    expect(onActivity).not.toHaveBeenCalled();
  });

  it('reports the peer snapshot, waiting for hello only when asked', async () => {
    const peer = new FakePeer();
    const { port, onActivity } = await startServer(peer);

    await expect(call(port, 'GET', '/status?wait=1', { token: TOKEN })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, daemon: { name: DAEMON_NAME, port: 0 }, extension: { connected: false, tools: [] } },
    });
    peer.connected = true;
    await expect(call(port, 'GET', '/status', { token: TOKEN })).resolves.toMatchObject({
      status: 200,
      body: { extension: { connected: true, extensionId: 'ext', tools: [TOOL] } },
    });
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it('forwards /rpc calls and maps bridge errors into the JSON body', async () => {
    const peer = new FakePeer();
    peer.nextResult = { count: 2, tags: [] };
    const { port } = await startServer(peer);

    await expect(call(port, 'POST', '/rpc', {
      token: TOKEN,
      body: JSON.stringify({ tool: 'listTags', args: { platform: 'github' } }),
    })).resolves.toMatchObject({ status: 200, body: { ok: true, result: { count: 2 } } });
    expect(peer.calls).toEqual([{ name: 'listTags', args: { platform: 'github' } }]);

    peer.nextResult = new BridgeCallError('invalid-args', 'bad platform');
    await expect(call(port, 'POST', '/rpc', {
      token: TOKEN,
      body: JSON.stringify({ tool: 'listTags' }),
    })).resolves.toMatchObject({ status: 200, body: { ok: false, code: 'invalid-args', message: 'bad platform' } });
    expect(peer.calls[1]).toEqual({ name: 'listTags', args: {} });
  });

  it('rejects malformed /rpc bodies and wrong methods without touching the peer', async () => {
    const peer = new FakePeer();
    const { port } = await startServer(peer);

    expect((await call(port, 'POST', '/rpc', { token: TOKEN, body: 'nope' })).status).toBe(400);
    expect((await call(port, 'POST', '/rpc', { token: TOKEN, body: '{"args":{}}' })).status).toBe(400);
    expect((await call(port, 'POST', '/rpc', { token: TOKEN, body: '{"tool":"x","args":[1]}' })).status).toBe(400);
    expect((await call(port, 'GET', '/rpc', { token: TOKEN })).status).toBe(405);
    expect((await call(port, 'GET', '/nowhere', { token: TOKEN })).status).toBe(404);
    expect(peer.calls).toEqual([]);
  });

  it('acknowledges /shutdown and then invokes the shutdown hook', async () => {
    const { port, onShutdown } = await startServer(new FakePeer());
    await expect(call(port, 'POST', '/shutdown', { token: TOKEN })).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
