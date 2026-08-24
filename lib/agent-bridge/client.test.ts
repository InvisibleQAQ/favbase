import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/agent-bridge', () => ({
  getAgentBridgeConfig: vi.fn(),
  getAgentBridgeStatus: vi.fn(),
  setAgentBridgeStatus: vi.fn(),
}));

import { AgentBridgeToolCallError } from './tool-registry';
import { decodeAgentBridgeMessage, type AgentBridgeToolDescriptor } from './protocol';
import {
  AgentBridgeClient,
  type BridgeTransport,
  type BridgeTransportFactory,
  type BridgeTransportHandlers,
} from './client';
import type {
  AgentBridgeConfig,
  AgentBridgeStatus,
} from '@/lib/storage/agent-bridge';
import type { FavbaseDb } from '@/lib/database';

const TOOL: AgentBridgeToolDescriptor = {
  name: 'searchKnowledgeBase',
  description: 'Search saved knowledge',
  inputSchema: { type: 'object' },
};

class FakeTransport implements BridgeTransport {
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly handlers: BridgeTransportHandlers) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  async open(): Promise<void> {
    await this.handlers.onOpen();
  }

  async message(message: unknown): Promise<void> {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    await this.handlers.onMessage(data);
  }

  async remoteClose(): Promise<void> {
    await this.handlers.onClose({ code: 1006, reason: 'gone' });
  }
}

function wire(type: string, payload: object, id = `server-${type}`): object {
  return {
    channel: 'favbase-agent-bridge',
    protocolVersion: 1,
    id,
    type,
    payload,
  };
}

describe('Agent Bridge client', () => {
  let config: AgentBridgeConfig;
  let status: AgentBridgeStatus;
  let now: number;
  let transports: FakeTransport[];
  let urls: string[];
  let createTransport: BridgeTransportFactory;
  let getDb = vi.fn<() => Promise<FavbaseDb>>();
  let callTool = vi.fn<(
    name: string,
    args: unknown,
    db: FavbaseDb,
  ) => Promise<unknown>>();
  const fakeDb = { kind: 'db' } as unknown as FavbaseDb;

  beforeEach(() => {
    config = {
      enabled: true,
      port: 17_836,
      token: 'bridge-token',
      tokenCreatedAt: 1,
    };
    status = {
      state: 'disconnected',
      lastConnectedAt: null,
      lastError: null,
      authFailureCount: 0,
      nextRetryAt: null,
    };
    now = 1_000;
    transports = [];
    urls = [];
    createTransport = (url, handlers) => {
      urls.push(url);
      const transport = new FakeTransport(handlers);
      transports.push(transport);
      return transport;
    };
    getDb = vi.fn<() => Promise<FavbaseDb>>().mockResolvedValue(fakeDb);
    callTool = vi.fn<(
      name: string,
      args: unknown,
      db: FavbaseDb,
    ) => Promise<unknown>>().mockResolvedValue({ count: 1 });
  });

  function createClient(): AgentBridgeClient {
    let id = 0;
    return new AgentBridgeClient({
      createTransport,
      getConfig: async () => config,
      getStatus: async () => status,
      setStatus: async (next) => { status = next; },
      getDb,
      describeTools: () => [TOOL],
      callTool,
      runtimeInfo: () => ({ extensionId: 'extension-id', extensionVersion: '0.0.5' }),
      now: () => now,
      createId: () => `client-${++id}`,
    });
  }

  it('handles hello, welcome, call, ping, and remote close', async () => {
    const client = createClient();

    await client.tryConnect();
    expect(urls).toEqual(['ws://127.0.0.1:17836/bridge']);
    expect(status.state).toBe('connecting');

    const transport = transports[0];
    await transport.open();
    const hello = decodeAgentBridgeMessage(JSON.parse(transport.sent[0]));
    expect(hello).toMatchObject({
      type: 'hello',
      payload: {
        token: 'bridge-token',
        extensionId: 'extension-id',
        extensionVersion: '0.0.5',
        tools: [TOOL],
      },
    });

    await transport.message(wire('welcome', {
      token: 'bridge-token',
      serverVersion: '0.0.5',
    }));
    expect(status).toMatchObject({
      state: 'connected',
      lastConnectedAt: 1_000,
      lastError: null,
      authFailureCount: 0,
      nextRetryAt: null,
    });

    await transport.message(wire('ping', {}, 'ping-1'));
    expect(decodeAgentBridgeMessage(JSON.parse(transport.sent.at(-1)!))).toMatchObject({
      id: 'ping-1',
      type: 'pong',
    });

    await transport.message(wire('tools.call', {
      callId: 'call-1',
      name: 'searchKnowledgeBase',
      args: { query: 'favbase' },
    }));
    expect(getDb).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith(
      'searchKnowledgeBase',
      { query: 'favbase' },
      fakeDb,
    );
    expect(decodeAgentBridgeMessage(JSON.parse(transport.sent.at(-1)!))).toMatchObject({
      type: 'tools.result',
      payload: { callId: 'call-1', ok: true, result: { count: 1 } },
    });

    await transport.remoteClose();
    expect(status).toMatchObject({ state: 'disconnected', lastError: 'connection-closed' });
  });

  it('maps tool and DB failures to stable wire errors', async () => {
    const client = createClient();
    await client.tryConnect();
    const transport = transports[0];
    await transport.open();
    await transport.message(wire('welcome', {
      token: 'bridge-token',
      serverVersion: '0.0.5',
    }));

    callTool.mockRejectedValueOnce(new AgentBridgeToolCallError('invalid-args', 'bad args'));
    await transport.message(wire('tools.call', {
      callId: 'bad-args',
      name: 'searchKnowledgeBase',
      args: {},
    }));
    expect(decodeAgentBridgeMessage(JSON.parse(transport.sent.at(-1)!))).toMatchObject({
      payload: {
        callId: 'bad-args',
        ok: false,
        error: { code: 'invalid-args', message: 'bad args' },
      },
    });

    getDb.mockRejectedValueOnce(new Error('offscreen unavailable'));
    await transport.message(wire('tools.call', {
      callId: 'no-db',
      name: 'searchKnowledgeBase',
      args: {},
    }));
    expect(decodeAgentBridgeMessage(JSON.parse(transport.sent.at(-1)!))).toMatchObject({
      payload: {
        callId: 'no-db',
        ok: false,
        error: { code: 'db-unavailable', message: 'offscreen unavailable' },
      },
    });
  });

  it('persists bad-token exponential backoff across client instances', async () => {
    let client = createClient();
    await client.tryConnect();
    await transports[0].open();
    await transports[0].message(wire('reject', { reason: 'bad-token' }));

    expect(transports[0].closed).toBe(true);
    expect(status).toMatchObject({
      state: 'disconnected',
      lastError: 'bad-token',
      authFailureCount: 1,
      nextRetryAt: 31_000,
    });

    client = createClient();
    now = 30_999;
    await client.tryConnect();
    expect(transports).toHaveLength(1);

    now = 31_000;
    await client.tryConnect();
    await transports[1].open();
    await transports[1].message(wire('reject', { reason: 'bad-token' }));
    expect(status).toMatchObject({
      authFailureCount: 2,
      nextRetryAt: 91_000,
    });
  });

  it('closes malformed frames without dispatching a tool', async () => {
    const client = createClient();
    await client.tryConnect();
    const transport = transports[0];
    await transport.open();
    await transport.message('{not-json');

    expect(transport.closed).toBe(true);
    expect(callTool).not.toHaveBeenCalled();
    expect(status).toMatchObject({ state: 'disconnected', lastError: 'protocol-error' });
  });

  it('does not let an in-flight old config suppress the replacement connection', async () => {
    let resolveConfig!: (value: AgentBridgeConfig) => void;
    const getConfig = vi.fn(() => new Promise<AgentBridgeConfig>((resolve) => {
      resolveConfig = resolve;
    }));
    const client = new AgentBridgeClient({
      createTransport,
      getConfig,
      getStatus: async () => status,
      setStatus: async (next) => { status = next; },
      getDb,
      describeTools: () => [TOOL],
      callTool,
      runtimeInfo: () => ({ extensionId: 'extension-id', extensionVersion: '0.0.5' }),
      now: () => now,
      createId: () => 'client-id',
    });

    const oldAttempt = client.tryConnect();
    const close = client.close('config-changed');
    resolveConfig(config);
    await Promise.all([oldAttempt, close]);

    const replacement = client.tryConnect();
    resolveConfig(config);
    await replacement;

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(transports).toHaveLength(1);
  });

  it('writes the closed status after an in-flight connecting status settles', async () => {
    let resolveConnecting!: () => void;
    const connectingWrite = new Promise<void>((resolve) => {
      resolveConnecting = resolve;
    });
    const setStatus = vi.fn(async (next: AgentBridgeStatus) => {
      if (next.state === 'connecting') await connectingWrite;
      status = next;
    });
    const client = new AgentBridgeClient({
      createTransport,
      getConfig: async () => config,
      getStatus: async () => status,
      setStatus,
      getDb,
      describeTools: () => [TOOL],
      callTool,
      runtimeInfo: () => ({ extensionId: 'extension-id', extensionVersion: '0.0.5' }),
      now: () => now,
      createId: () => 'client-id',
    });

    const connect = client.tryConnect();
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'connecting' }),
    ));
    const close = client.close('config-changed');

    resolveConnecting();
    await Promise.all([connect, close]);

    expect(status.state).toBe('disconnected');
    expect(setStatus.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'disconnected' });
    expect(transports).toHaveLength(0);
  });
});
