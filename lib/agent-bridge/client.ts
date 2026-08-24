import type { FavbaseDb } from '@/lib/database';
import {
  getAgentBridgeConfig,
  getAgentBridgeStatus,
  setAgentBridgeStatus,
  type AgentBridgeConfig,
  type AgentBridgeStatus,
} from '@/lib/storage/agent-bridge';
import {
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
  type AgentBridgeToolErrorCode,
  type JsonValue,
} from './protocol';
import {
  AgentBridgeToolCallError,
  callTool,
  describeTools,
} from './tool-registry';

const AUTH_BACKOFF_BASE_MS = 30_000;
const AUTH_BACKOFF_MAX_MS = 5 * 60_000;

export interface BridgeTransportCloseEvent {
  code: number;
  reason: string;
}

export interface BridgeTransportHandlers {
  onOpen(): void | Promise<void>;
  onMessage(data: unknown): void | Promise<void>;
  onClose(event: BridgeTransportCloseEvent): void | Promise<void>;
  onError(error: unknown): void | Promise<void>;
}

export interface BridgeTransport {
  send(data: string): void;
  close(): void;
}

export type BridgeTransportFactory = (
  url: string,
  handlers: BridgeTransportHandlers,
) => BridgeTransport;

export class WebSocketTransport implements BridgeTransport {
  private readonly socket: WebSocket;

  constructor(url: string, handlers: BridgeTransportHandlers) {
    this.socket = new WebSocket(url);
    const invoke = (
      action: () => void | Promise<void>,
      reportFailure = true,
    ): void => {
      void Promise.resolve()
        .then(action)
        .catch((error) => {
          if (reportFailure) {
            invoke(() => handlers.onError(error), false);
          } else {
            console.error('[agent-bridge] transport event handler failed', error);
          }
        });
    };
    this.socket.addEventListener('open', () => invoke(handlers.onOpen));
    this.socket.addEventListener('message', (event) => invoke(() => handlers.onMessage(event.data)));
    this.socket.addEventListener('close', (event) => invoke(() => handlers.onClose({
      code: event.code,
      reason: event.reason,
    })));
    this.socket.addEventListener('error', (event) => invoke(() => handlers.onError(event), false));
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }
}

interface RuntimeInfo {
  extensionId: string;
  extensionVersion: string;
}

interface AgentBridgeClientOptions {
  getDb(): Promise<FavbaseDb>;
  createTransport?: BridgeTransportFactory;
  getConfig?: () => Promise<AgentBridgeConfig>;
  getStatus?: () => Promise<AgentBridgeStatus>;
  setStatus?: (status: AgentBridgeStatus) => Promise<void>;
  describeTools?: () => AgentBridgeToolDescriptor[];
  callTool?: (name: string, args: unknown, db: FavbaseDb) => Promise<unknown>;
  runtimeInfo?: () => RuntimeInfo;
  now?: () => number;
  createId?: () => string;
}

interface ActiveConnection {
  readonly config: AgentBridgeConfig;
  transport: BridgeTransport;
  authenticated: boolean;
}

export type AgentBridgeCloseReason = 'disabled' | 'config-changed';

export class AgentBridgeClient {
  private readonly options: Required<AgentBridgeClientOptions>;
  private connection: ActiveConnection | null = null;
  private connectAttempt: Promise<void> | null = null;
  private generation = 0;

  constructor(options: AgentBridgeClientOptions) {
    this.options = {
      createTransport: (url, handlers) => new WebSocketTransport(url, handlers),
      getConfig: getAgentBridgeConfig,
      getStatus: getAgentBridgeStatus,
      setStatus: setAgentBridgeStatus,
      describeTools,
      callTool,
      runtimeInfo: () => ({
        extensionId: browser.runtime.id,
        extensionVersion: browser.runtime.getManifest().version,
      }),
      now: Date.now,
      createId: () => crypto.randomUUID(),
      ...options,
    };
  }

  async tryConnect(): Promise<void> {
    if (this.connection || this.connectAttempt) return this.connectAttempt ?? undefined;
    const generation = this.generation;
    this.connectAttempt = this.openConnection(generation);
    try {
      await this.connectAttempt;
    } finally {
      this.connectAttempt = null;
    }
  }

  async close(reason: AgentBridgeCloseReason): Promise<void> {
    this.generation += 1;
    const pendingAttempt = this.connectAttempt;
    const connection = this.connection;
    this.connection = null;
    connection?.transport.close();

    if (pendingAttempt) {
      await pendingAttempt;
      if (this.connectAttempt === pendingAttempt) this.connectAttempt = null;
    }

    await this.patchStatus({
      state: reason === 'disabled' ? 'disabled' : 'disconnected',
      lastError: null,
      authFailureCount: 0,
      nextRetryAt: null,
    });
  }

  private async openConnection(generation: number): Promise<void> {
    const config = await this.options.getConfig();
    if (generation !== this.generation || this.connection) return;
    if (!config.enabled) {
      await this.patchStatus({ state: 'disabled', lastError: null });
      return;
    }
    if (!validPort(config.port) || config.token.trim() === '') {
      await this.patchStatus({
        state: 'disconnected',
        lastError: validPort(config.port) ? 'missing-token' : 'invalid-port',
      });
      return;
    }

    const status = await this.options.getStatus();
    if (generation !== this.generation || this.connection) return;
    if (status.nextRetryAt !== null && status.nextRetryAt > this.options.now()) return;

    await this.options.setStatus({ ...status, state: 'connecting', lastError: null });
    if (generation !== this.generation || this.connection) return;

    const connection = {
      config,
      transport: null as unknown as BridgeTransport,
      authenticated: false,
    } satisfies ActiveConnection;
    try {
      connection.transport = this.options.createTransport(
        `ws://127.0.0.1:${config.port}/bridge`,
        {
          onOpen: () => this.handleOpen(connection),
          onMessage: (data) => this.handleMessage(connection, data),
          onClose: () => this.handleRemoteClose(connection),
          onError: () => this.handleTransportError(connection),
        },
      );
      this.connection = connection;
    } catch (error) {
      await this.patchStatus({
        state: 'disconnected',
        lastError: errorMessage(error, 'connection-error'),
      });
    }
  }

  private async handleOpen(connection: ActiveConnection): Promise<void> {
    if (!this.isCurrent(connection)) return;
    const runtime = this.options.runtimeInfo();
    const hello = encodeAgentBridgeMessage({
      id: this.options.createId(),
      type: 'hello',
      payload: {
        token: connection.config.token,
        extensionId: runtime.extensionId,
        extensionVersion: runtime.extensionVersion,
        tools: this.options.describeTools(),
      },
    });
    if (!hello) {
      await this.disconnect(connection, 'protocol-error');
      return;
    }
    this.send(connection, hello);
  }

  private async handleMessage(
    connection: ActiveConnection,
    data: unknown,
  ): Promise<void> {
    if (!this.isCurrent(connection)) return;
    const message = parseMessage(data);
    if (!message) {
      await this.disconnect(connection, 'protocol-error');
      return;
    }

    if (!connection.authenticated) {
      await this.handleHandshakeMessage(connection, message);
      return;
    }

    switch (message.type) {
      case 'ping':
        this.sendInput(connection, { id: message.id, type: 'pong', payload: {} });
        return;
      case 'tools.call':
        await this.handleToolCall(connection, message);
        return;
      case 'reject':
        await this.handleReject(connection, message.payload.reason);
        return;
      default:
        await this.disconnect(connection, 'protocol-error');
    }
  }

  private async handleHandshakeMessage(
    connection: ActiveConnection,
    message: AgentBridgeMessage,
  ): Promise<void> {
    if (message.type === 'reject') {
      await this.handleReject(connection, message.payload.reason);
      return;
    }
    if (message.type !== 'welcome') {
      await this.disconnect(connection, 'protocol-error');
      return;
    }
    if (message.payload.token !== connection.config.token) {
      await this.applyAuthBackoff(connection, 'bad-token');
      return;
    }

    connection.authenticated = true;
    await this.patchConnectionStatus(connection, {
      state: 'connected',
      lastConnectedAt: this.options.now(),
      lastError: null,
      authFailureCount: 0,
      nextRetryAt: null,
    });
  }

  private async handleReject(
    connection: ActiveConnection,
    reason: 'bad-token' | 'bad-origin' | 'version',
  ): Promise<void> {
    if (reason === 'bad-token') {
      await this.applyAuthBackoff(connection, reason);
      return;
    }
    await this.disconnect(connection, reason);
  }

  private async applyAuthBackoff(
    connection: ActiveConnection,
    error: 'bad-token',
  ): Promise<void> {
    if (!this.isCurrent(connection)) return;
    const status = await this.options.getStatus();
    if (!this.isCurrent(connection)) return;
    const authFailureCount = status.authFailureCount + 1;
    const delay = Math.min(
      AUTH_BACKOFF_BASE_MS * 2 ** (authFailureCount - 1),
      AUTH_BACKOFF_MAX_MS,
    );
    await this.options.setStatus({
      ...status,
      state: 'disconnected',
      lastError: error,
      authFailureCount,
      nextRetryAt: this.options.now() + delay,
    });
    this.dropConnection(connection);
  }

  private async handleToolCall(
    connection: ActiveConnection,
    message: Extract<AgentBridgeMessage, { type: 'tools.call' }>,
  ): Promise<void> {
    const { callId, name, args } = message.payload;
    let db: FavbaseDb;
    try {
      db = await this.options.getDb();
    } catch (error) {
      this.sendToolError(connection, callId, 'db-unavailable', error);
      return;
    }

    try {
      const result = await this.options.callTool(name, args, db);
      if (!this.isCurrent(connection)) return;
      const sent = this.sendInput(connection, {
        id: this.options.createId(),
        type: 'tools.result',
        payload: { callId, ok: true, result: result as JsonValue },
      });
      if (!sent) {
        this.sendToolError(
          connection,
          callId,
          'execution-failed',
          new Error('Knowledge Tool returned a non-JSON result'),
        );
      }
    } catch (error) {
      const code = error instanceof AgentBridgeToolCallError
        ? error.code
        : 'execution-failed';
      this.sendToolError(connection, callId, code, error);
    }
  }

  private sendToolError(
    connection: ActiveConnection,
    callId: string,
    code: AgentBridgeToolErrorCode,
    error: unknown,
  ): void {
    if (!this.isCurrent(connection)) return;
    this.sendInput(connection, {
      id: this.options.createId(),
      type: 'tools.result',
      payload: {
        callId,
        ok: false,
        error: { code, message: errorMessage(error, code) },
      },
    });
  }

  private async handleRemoteClose(connection: ActiveConnection): Promise<void> {
    if (!this.isCurrent(connection)) return;
    this.connection = null;
    await this.patchStatus({ state: 'disconnected', lastError: 'connection-closed' });
  }

  private async handleTransportError(connection: ActiveConnection): Promise<void> {
    await this.disconnect(connection, 'connection-error');
  }

  private async disconnect(connection: ActiveConnection, lastError: string): Promise<void> {
    if (!this.isCurrent(connection)) return;
    this.connection = null;
    connection.transport.close();
    await this.patchStatus({ state: 'disconnected', lastError });
  }

  private dropConnection(connection: ActiveConnection): void {
    if (!this.isCurrent(connection)) return;
    this.connection = null;
    connection.transport.close();
  }

  private sendInput(connection: ActiveConnection, input: AgentBridgeMessageInput): boolean {
    const message = encodeAgentBridgeMessage(input);
    if (!message) return false;
    this.send(connection, message);
    return true;
  }

  private send(connection: ActiveConnection, message: AgentBridgeMessage): void {
    if (!this.isCurrent(connection)) return;
    connection.transport.send(JSON.stringify(message));
  }

  private isCurrent(connection: ActiveConnection): boolean {
    return this.connection === connection;
  }

  private async patchConnectionStatus(
    connection: ActiveConnection,
    patch: Partial<AgentBridgeStatus>,
  ): Promise<void> {
    if (!this.isCurrent(connection)) return;
    const status = await this.options.getStatus();
    if (!this.isCurrent(connection)) return;
    await this.options.setStatus({ ...status, ...patch });
  }

  private async patchStatus(patch: Partial<AgentBridgeStatus>): Promise<void> {
    const status = await this.options.getStatus();
    await this.options.setStatus({ ...status, ...patch });
  }
}

function parseMessage(data: unknown): AgentBridgeMessage | null {
  if (typeof data !== 'string') return null;
  try {
    return decodeAgentBridgeMessage(JSON.parse(data));
  } catch {
    return null;
  }
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}
