import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket, type RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
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
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
};

interface McpProcess {
  client: Client;
  stderr: string[];
  transport: StdioClientTransport;
}

const clients: McpProcess[] = [];
const sockets: WebSocket[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(clients.splice(0).map(({ client }) => client.close()));
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
});

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

async function startMcpProcess(port: number): Promise<McpProcess> {
  const transport: StdioClientTransport = new StdioClientTransport({
    command: globalThis.process.execPath,
    args: [CLI_PATH],
    env: {
      FAVBASE_BRIDGE_PORT: String(port),
      FAVBASE_TOKEN: TOKEN,
    },
    stderr: 'pipe',
  });
  const stderr: string[] = [];
  const client = new Client({ name: 'favbase-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  transport.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
  const mcpProcess: McpProcess = { client, stderr, transport };
  clients.push(mcpProcess);
  return mcpProcess;
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
  if (!message) throw new Error('Invalid Agent Bridge test message');
  socket.send(JSON.stringify(message));
}

function nextMessage(socket: WebSocket): Promise<AgentBridgeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Agent Bridge message'));
    }, 2_000);
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

async function waitForText(chunks: string[], expected: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!chunks.join('').includes(expected)) {
    if (Date.now() >= deadline) throw new Error(`Missing stderr text: ${expected}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Child process did not exit')), 2_000);
    child.once('exit', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
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

describe('favbase-mcp process integration', () => {
  it('returns an empty pre-hello list, then mirrors tools and calls the fake extension', async () => {
    const port = await freePort();
    const mcp = await startMcpProcess(port);

    await expect(mcp.client.listTools()).resolves.toMatchObject({ tools: [] });
    await waitForText(mcp.stderr, 'has not completed hello');

    const extension = await connectExtension(port);
    const welcome = nextMessage(extension);
    send(extension, {
      id: 'hello-1',
      type: 'hello',
      payload: {
        token: TOKEN,
        extensionId: EXTENSION_ID,
        extensionVersion: '0.0.5',
        tools: [TOOL],
      },
    });
    await expect(welcome).resolves.toMatchObject({
      type: 'welcome',
      payload: { token: TOKEN },
    });
    await expect(mcp.client.listTools()).resolves.toMatchObject({ tools: [TOOL] });

    const forwardedCall = nextMessage(extension);
    const result = mcp.client.callTool({
      name: TOOL.name,
      arguments: { query: 'favbase' },
    });
    const callMessage = await forwardedCall;
    expect(callMessage).toMatchObject({
      type: 'tools.call',
      payload: { name: TOOL.name, args: { query: 'favbase' } },
    });
    if (callMessage.type !== 'tools.call') throw new Error('Expected tools.call');
    send(extension, {
      id: 'result-1',
      type: 'tools.result',
      payload: {
        callId: callMessage.payload.callId,
        ok: true,
        result: { count: 1 },
      },
    });
    await expect(result).resolves.toMatchObject({
      content: [{ type: 'text', text: '{"count":1}' }],
    });
  });

  it('rejects a fake extension with the wrong Bridge Token', async () => {
    const port = await freePort();
    const mcp = await startMcpProcess(port);
    const extension = await connectExtension(port);
    const rejection = nextMessage(extension);

    send(extension, {
      id: 'hello-bad-token',
      type: 'hello',
      payload: {
        token: 'wrong-token',
        extensionId: EXTENSION_ID,
        extensionVersion: '0.0.5',
        tools: [TOOL],
      },
    });

    await expect(rejection).resolves.toMatchObject({
      type: 'reject',
      payload: { reason: 'bad-token' },
    });
    await expect(mcp.client.listTools()).resolves.toMatchObject({ tools: [] });
  });

  it('rejects WebSocket upgrades outside the bridge path', async () => {
    const port = await freePort();
    await startMcpProcess(port);
    await expectUpgradeRejected(
      port,
      '/not-the-bridge',
      `chrome-extension://${EXTENSION_ID}`,
      400,
    );
  });

  it('rejects a non-extension WebSocket Origin with HTTP 403', async () => {
    const port = await freePort();
    await startMcpProcess(port);
    await expectUpgradeRejected(port, '/bridge', 'http://127.0.0.1', 403);
  });

  it('exits the second instance with code 1 when the port is occupied', async () => {
    const port = await freePort();
    await startMcpProcess(port);

    const child = spawn(process.execPath, [CLI_PATH], {
      env: {
        ...process.env,
        FAVBASE_BRIDGE_PORT: String(port),
        FAVBASE_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    const stderr: string[] = [];
    child.stderr?.on('data', chunk => stderr.push(chunk.toString()));

    await expect(waitForExit(child)).resolves.toBe(1);
    expect(stderr.join('')).toContain(`bridge port ${port} is already in use`);
  });
});
