import { DB_CHANNEL_NAME } from './constants';
import { createChromePortTransport } from './bridges/chrome-port-rpc';
import { PGliteSharedProxy } from './bridges/proxy-driver';

/** Create one ready RPC client for the Offscreen-owned PGlite instance. */
export async function createDbProxyClient(
  ensureOffscreen?: () => Promise<void>,
): Promise<PGliteSharedProxy> {
  const transport = await createChromePortTransport({
    channelName: DB_CHANNEL_NAME,
    ensureOffscreen,
  });
  const proxy = new PGliteSharedProxy(transport);
  await proxy.waitReady;
  return proxy;
}
