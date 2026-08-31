import { once } from 'node:events';
import { performance } from 'node:perf_hooks';

import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  encodeAgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
} from '../../lib/agent-bridge/protocol';
import { BridgeServer } from './bridge-server';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = 'test-token';
const TOOL: AgentBridgeToolDescriptor = {
  name: 'listTags',
  description: 'List tags',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {},
  },
};

const servers: BridgeServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map(server => server.close()));
});

async function startServer(helloWaitMs: number): Promise<BridgeServer> {
  const server = new BridgeServer({
    port: 0,
    token: TOKEN,
    serverVersion: 'test',
    helloWaitMs,
  });
  servers.push(server);
  await server.start();
  return server;
}

async function helloFromFakeExtension(server: BridgeServer): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.listeningPort}/bridge`, {
    origin: `chrome-extension://${EXTENSION_ID}`,
  });
  sockets.push(socket);
  await once(socket, 'open');
  const hello: AgentBridgeMessageInput = {
    id: 'hello-1',
    type: 'hello',
    payload: {
      token: TOKEN,
      extensionId: EXTENSION_ID,
      extensionVersion: '0.0.5',
      tools: [TOOL],
    },
  };
  socket.send(JSON.stringify(encodeAgentBridgeMessage(hello)));
  await once(socket, 'message'); // welcome
  return socket;
}

describe('BridgeServer bounded waits', () => {
  it('rejects a call within the configured hello deadline', async () => {
    const server = await startServer(40);

    const startedAt = performance.now();
    await expect(server.callTool('searchKnowledgeBase', { query: 'favbase' }))
      .rejects.toMatchObject({
        code: 'extension-unavailable',
      });
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('honors cancellation while waiting for hello', async () => {
    const server = await startServer(5_000);

    const controller = new AbortController();
    const call = server.callTool('listTags', {}, controller.signal);
    controller.abort();

    await expect(call).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('lists tools only after hello, within the same bounded wait as calls', async () => {
    const server = await startServer(5_000);

    const listing = server.listTools();
    await helloFromFakeExtension(server);

    await expect(listing).resolves.toEqual([TOOL]);
  });

  it('rejects a listing on the hello deadline instead of answering empty', async () => {
    const server = await startServer(40);

    const startedAt = performance.now();
    await expect(server.listTools()).rejects.toMatchObject({
      code: 'extension-unavailable',
    });
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('honors cancellation while a listing waits for hello', async () => {
    const server = await startServer(5_000);

    const controller = new AbortController();
    const listing = server.listTools(controller.signal);
    controller.abort();

    await expect(listing).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('notifies peer-ready listeners once per authenticated hello', async () => {
    const server = await startServer(5_000);
    const listener = vi.fn();
    const unsubscribe = server.onPeerReady(listener);

    await helloFromFakeExtension(server);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await helloFromFakeExtension(server);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
