import { createServer, type Server } from 'node:http';

import {
  BridgePortInUseError,
  BridgeServer,
  isPortInUseError,
  LOOPBACK_HOST,
  type BridgeLogger,
} from './bridge-server';
import { createRpcHandler } from './rpc-server';

export interface DaemonOptions {
  port: number;
  token: string;
  version: string;
  /** Minutes without a CLI request or authenticated extension peer before the daemon exits; `0` disables. */
  idleMinutes: number;
  logger: BridgeLogger;
  helloWaitMs?: number;
  callTimeoutMs?: number;
}

/**
 * One loopback HTTP server carrying both halves of the Agent Bridge: the
 * extension's `/bridge` WebSocket (owned by `BridgeServer`) and the CLI's JSON
 * routes (owned by `createRpcHandler`). Lives until `close()`, a `/shutdown`
 * request, or the idle deadline when no authenticated extension peer exists.
 */
export class Daemon {
  private readonly bridge: BridgeServer;
  private readonly server: Server;
  private readonly options: DaemonOptions;
  private readonly startedAt = Date.now();
  private closed = false;
  private closing?: Promise<void>;
  private idleTimer?: NodeJS.Timeout;
  private resolveClosed!: () => void;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(options: DaemonOptions) {
    this.options = options;
    this.server = createServer();
    this.bridge = new BridgeServer({
      server: this.server,
      port: options.port,
      token: options.token,
      serverVersion: options.version,
      logger: options.logger,
      helloWaitMs: options.helloWaitMs,
      callTimeoutMs: options.callTimeoutMs,
      onPeerActivity: () => this.touch(),
      onPeerDisconnected: () => this.touch(),
    });
    this.server.on('request', createRpcHandler({
      token: options.token,
      version: options.version,
      port: options.port,
      startedAt: this.startedAt,
      idleMinutes: options.idleMinutes,
      peer: this.bridge,
      onActivity: () => this.touch(),
      onShutdown: () => void this.close(),
    }));
  }

  get port(): number | null {
    const address = this.server.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  async start(): Promise<void> {
    await this.bridge.start();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: unknown) => {
        reject(isPortInUseError(error) ? new BridgePortInUseError(this.options.port) : error);
      };
      this.server.once('error', onError);
      this.server.listen(this.options.port, LOOPBACK_HOST, () => {
        this.server.off('error', onError);
        resolve();
      });
    });
    this.server.on('error', (error) => {
      this.options.logger.error(`[favbase] daemon server error: ${error.message}`);
    });
    this.touch();
  }

  /** Resolves once the daemon has fully shut down (by any cause). */
  whenClosed(): Promise<void> {
    return this.closedPromise;
  }

  close(): Promise<void> {
    if (!this.closing) this.closing = this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.bridge.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.resolveClosed();
  }

  private touch(): void {
    if (this.closed || this.options.idleMinutes <= 0) return;
    if (this.bridge.peerSnapshot().connected) {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
      return;
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.options.logger.error(
        `[favbase] daemon idle for ${this.options.idleMinutes} minutes; exiting`,
      );
      void this.close();
    }, this.options.idleMinutes * 60_000);
  }
}
