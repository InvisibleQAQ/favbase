import type { RpcRequest, RpcResponse, RpcTransport } from './types';
import { serializeForRpc } from './serialization';

interface ChromePortTransportOptions {
  channelName: string;
  ensureOffscreen?: () => Promise<void>;
}

const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 2000;
const BACKOFF_FACTOR = 2;
const STABLE_THRESHOLD_MS = 1000;

export async function createChromePortTransport(
  options: ChromePortTransportOptions,
): Promise<RpcTransport> {
  const { channelName, ensureOffscreen } = options;

  let port: chrome.runtime.Port | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let connectTime = 0;
  let disposed = false;
  const subscribers = new Set<(msg: RpcResponse) => void>();
  const queue: RpcRequest[] = [];

  function isRpcResponse(msg: unknown): msg is RpcResponse {
    return (
      typeof msg === 'object' &&
      msg !== null &&
      typeof (msg as RpcResponse).id === 'number' &&
      typeof (msg as RpcResponse).ok === 'boolean'
    );
  }

  function handleMessage(msg: unknown): void {
    if (!isRpcResponse(msg)) return;
    for (const handler of subscribers) {
      handler(msg);
    }
  }

  function handleDisconnect(): void {
    port = null;
    if (disposed) return;
    const wasStable = Date.now() - connectTime > STABLE_THRESHOLD_MS;
    if (wasStable) backoff = INITIAL_BACKOFF_MS;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * BACKOFF_FACTOR, MAX_BACKOFF_MS);
  }

  async function connect(): Promise<void> {
    if (disposed || port) return;
    try {
      if (ensureOffscreen) await ensureOffscreen();
      const p = chrome.runtime.connect({ name: channelName });
      p.onMessage.addListener(handleMessage);
      p.onDisconnect.addListener(handleDisconnect);
      port = p;
      connectTime = Date.now();
      flushQueue();
    } catch {
      if (!disposed) setTimeout(connect, backoff);
    }
  }

  function flushQueue(): void {
    while (queue.length > 0 && port) {
      const msg = queue.shift()!;
      try {
        port.postMessage(serializeForRpc(msg));
      } catch {
        queue.unshift(msg);
        break;
      }
    }
  }

  await connect();

  return {
    post(msg: RpcRequest): void {
      if (port) {
        try {
          port.postMessage(serializeForRpc(msg));
        } catch {
          queue.push(msg);
          connect();
        }
      } else {
        queue.push(msg);
        connect();
      }
    },
    subscribe(handler: (msg: RpcResponse) => void): () => void {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
        if (subscribers.size === 0) {
          disposed = true;
          port?.disconnect();
          port = null;
        }
      };
    },
  };
}
