import { randomUUID, timingSafeEqual } from 'node:crypto';

import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';

import {
  decodeAgentBridgeMessage,
  encodeAgentBridgeMessage,
  type AgentBridgeMessage,
  type AgentBridgeMessageInput,
  type AgentBridgeToolDescriptor,
  type AgentBridgeToolErrorCode,
  type JsonObject,
  type JsonValue,
} from '../../lib/agent-bridge/protocol';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_HELLO_WAIT_MS = 35_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 20_000;

type HelloMessage = Extract<AgentBridgeMessage, { type: 'hello' }>;
type ToolResultMessage = Extract<AgentBridgeMessage, { type: 'tools.result' }>;

export interface BridgeLogger {
  error(message: string): void;
}

export interface BridgeServerOptions {
  port: number;
  token: string;
  serverVersion: string;
  helloWaitMs?: number;
  callTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  heartbeatMs?: number;
  logger?: BridgeLogger;
}

export type BridgeCallErrorCode =
  | AgentBridgeToolErrorCode
  | 'extension-unavailable'
  | 'extension-disconnected'
  | 'timeout'
  | 'cancelled';

export class BridgeCallError extends Error {
  constructor(
    readonly code: BridgeCallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeCallError';
  }
}

export class BridgePortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Bridge port ${port} is already in use`);
    this.name = 'BridgePortInUseError';
  }
}

interface CandidateConnection {
  authenticated: boolean;
  handshakeTimer: NodeJS.Timeout;
  originExtensionId: string;
  socket: WebSocket;
}

interface AuthenticatedPeer {
  extensionId: string;
  socket: WebSocket;
  tools: AgentBridgeToolDescriptor[];
}

interface PeerWaiter {
  onAbort?: () => void;
  reject(error: BridgeCallError): void;
  resolve(peer: AuthenticatedPeer): void;
  signal?: AbortSignal;
  timeout: NodeJS.Timeout;
}

interface PendingCall {
  onAbort?: () => void;
  reject(error: BridgeCallError): void;
  resolve(result: JsonValue): void;
  signal?: AbortSignal;
  timeout: NodeJS.Timeout;
}

function extensionIdFromOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const match = /^chrome-extension:\/\/([a-z0-9_-]{1,128})$/i.exec(origin);
  return match?.[1] ?? null;
}

function tokensMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}

function isPortInUseError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'EADDRINUSE';
}

function parseMessage(data: RawData): AgentBridgeMessage | null {
  try {
    return decodeAgentBridgeMessage(JSON.parse(data.toString()));
  } catch {
    return null;
  }
}

export class BridgeServer {
  private readonly callTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly helloWaitMs: number;
  private readonly logger: BridgeLogger;
  private readonly options: BridgeServerOptions;
  private readonly peerWaiters = new Set<PeerWaiter>();
  private readonly pendingCalls = new Map<string, PendingCall>();

  private heartbeatTimer?: NodeJS.Timeout;
  private peer?: AuthenticatedPeer;
  private webSocketServer?: WebSocketServer;

  constructor(options: BridgeServerOptions) {
    this.options = options;
    this.helloWaitMs = options.helloWaitMs ?? DEFAULT_HELLO_WAIT_MS;
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.logger = options.logger ?? { error: () => undefined };
  }

  get listeningPort(): number | null {
    const address = this.webSocketServer?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  listTools(): readonly AgentBridgeToolDescriptor[] {
    return this.peer?.tools ?? [];
  }

  async start(): Promise<void> {
    if (this.webSocketServer) return;

    const server = new WebSocketServer({
      host: LOOPBACK_HOST,
      path: '/bridge',
      port: this.options.port,
      verifyClient: (
        { origin }: { origin: string },
        accept: (accepted: boolean, code?: number, message?: string) => void,
      ) => {
        const accepted = extensionIdFromOrigin(origin) !== null;
        accept(accepted, accepted ? undefined : 403, accepted ? undefined : 'Forbidden');
      },
    });
    this.webSocketServer = server;
    server.on('connection', (socket, request) => {
      this.acceptConnection(socket, request.headers.origin);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    } catch (error) {
      this.webSocketServer = undefined;
      if (isPortInUseError(error)) {
        throw new BridgePortInUseError(this.options.port);
      }
      throw error;
    }
  }

  async callTool(
    name: string,
    args: JsonObject,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    const peer = await this.waitForPeer(signal);
    const callId = randomUUID();

    return new Promise<JsonValue>((resolve, reject) => {
      const pending: PendingCall = {
        resolve,
        reject,
        signal,
        timeout: setTimeout(() => {
          this.finishPendingCall(callId, {
            error: new BridgeCallError('timeout', `Knowledge Tool ${name} timed out`),
          });
        }, this.callTimeoutMs),
      };

      if (signal) {
        pending.onAbort = () => {
          this.finishPendingCall(callId, {
            error: new BridgeCallError('cancelled', `Knowledge Tool ${name} was cancelled`),
          });
        };
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }

      this.pendingCalls.set(callId, pending);
      try {
        this.send(peer.socket, {
          id: randomUUID(),
          type: 'tools.call',
          payload: { callId, name, args },
        });
      } catch {
        this.finishPendingCall(callId, {
          error: new BridgeCallError(
            'extension-disconnected',
            'favbase extension disconnected before the Knowledge Tool was sent',
          ),
        });
      }
    });
  }

  async close(): Promise<void> {
    this.stopHeartbeat();
    this.rejectPeerWaiters(new BridgeCallError(
      'extension-unavailable',
      'favbase MCP bridge stopped before the extension connected',
    ));
    this.rejectPendingCalls(new BridgeCallError(
      'extension-disconnected',
      'favbase extension disconnected before the Knowledge Tool completed',
    ));

    const server = this.webSocketServer;
    this.webSocketServer = undefined;
    this.peer = undefined;
    if (!server) return;

    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private acceptConnection(socket: WebSocket, origin: string | undefined): void {
    const originExtensionId = extensionIdFromOrigin(origin);
    if (!originExtensionId) {
      socket.close(1008, 'bad-origin');
      return;
    }

    const candidate: CandidateConnection = {
      authenticated: false,
      originExtensionId,
      socket,
      handshakeTimer: setTimeout(() => socket.close(1008, 'hello-timeout'), this.handshakeTimeoutMs),
    };
    socket.on('message', data => this.handleMessage(candidate, data));
    socket.once('close', () => this.handleClose(candidate));
    socket.once('error', error => {
      this.logger.error(`[favbase-mcp] WebSocket error: ${error.message}`);
    });
  }

  private handleMessage(candidate: CandidateConnection, data: RawData): void {
    const message = parseMessage(data);
    if (!message) {
      candidate.socket.close(1002, 'invalid-message');
      return;
    }

    if (!candidate.authenticated) {
      this.authenticate(candidate, message);
      return;
    }

    if (message.type === 'tools.result') {
      this.handleToolResult(message);
      return;
    }
    if (message.type !== 'pong') candidate.socket.close(1002, 'unexpected-message');
  }

  private authenticate(
    candidate: CandidateConnection,
    message: AgentBridgeMessage,
  ): void {
    if (message.type !== 'hello') {
      candidate.socket.close(1002, 'hello-required');
      return;
    }
    if (!tokensMatch(message.payload.token, this.options.token)) {
      this.reject(candidate.socket, message.id, 'bad-token');
      return;
    }
    if (message.payload.extensionId !== candidate.originExtensionId) {
      this.reject(candidate.socket, message.id, 'bad-origin');
      return;
    }

    this.activatePeer(candidate, message);
  }

  private activatePeer(
    candidate: CandidateConnection,
    message: HelloMessage,
  ): void {
    clearTimeout(candidate.handshakeTimer);
    candidate.authenticated = true;

    const previousPeer = this.peer;
    if (previousPeer && previousPeer.socket !== candidate.socket) {
      this.rejectPendingCalls(new BridgeCallError(
        'extension-disconnected',
        'favbase extension reconnected before the Knowledge Tool completed',
      ));
      previousPeer.socket.close(1012, 'extension-reconnected');
    }

    const peer: AuthenticatedPeer = {
      extensionId: message.payload.extensionId,
      socket: candidate.socket,
      tools: message.payload.tools,
    };
    this.peer = peer;
    this.send(candidate.socket, {
      id: message.id,
      type: 'welcome',
      payload: {
        token: this.options.token,
        serverVersion: this.options.serverVersion,
      },
    });
    this.resolvePeerWaiters(peer);
    this.startHeartbeat(peer);
  }

  private handleToolResult(message: ToolResultMessage): void {
    const pending = this.pendingCalls.get(message.payload.callId);
    if (!pending) return;

    if (message.payload.ok) {
      this.finishPendingCall(message.payload.callId, { result: message.payload.result });
      return;
    }
    this.finishPendingCall(message.payload.callId, {
      error: new BridgeCallError(message.payload.error.code, message.payload.error.message),
    });
  }

  private handleClose(candidate: CandidateConnection): void {
    clearTimeout(candidate.handshakeTimer);
    if (this.peer?.socket !== candidate.socket) return;

    this.peer = undefined;
    this.stopHeartbeat();
    this.rejectPendingCalls(new BridgeCallError(
      'extension-disconnected',
      'favbase extension disconnected before the Knowledge Tool completed',
    ));
  }

  private waitForPeer(signal?: AbortSignal): Promise<AuthenticatedPeer> {
    if (this.peer?.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.peer);
    if (signal?.aborted) {
      return Promise.reject(new BridgeCallError('cancelled', 'Knowledge Tool call was cancelled'));
    }

    return new Promise<AuthenticatedPeer>((resolve, reject) => {
      const waiter: PeerWaiter = {
        resolve,
        reject,
        signal,
        timeout: setTimeout(() => {
          this.finishPeerWaiter(waiter, {
            error: new BridgeCallError(
              'extension-unavailable',
              'favbase extension is not connected; open Chrome and enable Agent Bridge with the same port and token',
            ),
          });
        }, this.helloWaitMs),
      };
      if (signal) {
        waiter.onAbort = () => {
          this.finishPeerWaiter(waiter, {
            error: new BridgeCallError('cancelled', 'Knowledge Tool call was cancelled'),
          });
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.peerWaiters.add(waiter);
    });
  }

  private resolvePeerWaiters(peer: AuthenticatedPeer): void {
    for (const waiter of [...this.peerWaiters]) {
      this.finishPeerWaiter(waiter, { peer });
    }
  }

  private rejectPeerWaiters(error: BridgeCallError): void {
    for (const waiter of [...this.peerWaiters]) {
      this.finishPeerWaiter(waiter, { error });
    }
  }

  private finishPeerWaiter(
    waiter: PeerWaiter,
    outcome: { peer: AuthenticatedPeer } | { error: BridgeCallError },
  ): void {
    if (!this.peerWaiters.delete(waiter)) return;
    clearTimeout(waiter.timeout);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    if ('peer' in outcome) waiter.resolve(outcome.peer);
    else waiter.reject(outcome.error);
  }

  private rejectPendingCalls(error: BridgeCallError): void {
    for (const callId of [...this.pendingCalls.keys()]) {
      this.finishPendingCall(callId, { error });
    }
  }

  private finishPendingCall(
    callId: string,
    outcome: { result: JsonValue } | { error: BridgeCallError },
  ): void {
    const pending = this.pendingCalls.get(callId);
    if (!pending) return;
    this.pendingCalls.delete(callId);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    if ('result' in outcome) pending.resolve(outcome.result);
    else pending.reject(outcome.error);
  }

  private startHeartbeat(peer: AuthenticatedPeer): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (peer.socket.readyState !== WebSocket.OPEN) return;
      this.send(peer.socket, {
        id: randomUUID(),
        type: 'ping',
        payload: {},
      });
    }, this.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private reject(
    socket: WebSocket,
    id: string,
    reason: 'bad-token' | 'bad-origin' | 'version',
  ): void {
    this.send(socket, { id, type: 'reject', payload: { reason } });
    socket.close(1008, reason);
  }

  private send(socket: WebSocket, input: AgentBridgeMessageInput): void {
    const message = encodeAgentBridgeMessage(input);
    if (!message) throw new Error('Attempted to send an invalid Agent Bridge message');
    socket.send(JSON.stringify(message));
  }
}
