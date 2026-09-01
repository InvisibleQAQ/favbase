import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import type { ResolvedConfig } from './config';
import { fetchStatus } from './daemon-client';

const TOKEN = 'daemon-client-test-token';
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function serveStatus(extension: unknown): Promise<ResolvedConfig> {
  const server = createServer((_request, response) => {
    const body = JSON.stringify({
      ok: true,
      daemon: {
        name: 'favbase-cli',
        version: 'old-or-untrusted',
        pid: process.pid,
        port: 0,
        startedAt: 1,
        idleMinutes: 120,
      },
      extension,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not listen');
  return {
    token: TOKEN,
    port: address.port,
    tokenSource: 'env',
    portSource: 'env',
    configPath: 'unused',
  };
}

describe('daemon status client boundary', () => {
  it('supplies additive diagnostic defaults for an older daemon status shape', async () => {
    const config = await serveStatus({ connected: false, extensionId: null, tools: [] });

    await expect(fetchStatus(config, false)).resolves.toMatchObject({
      extension: {
        connected: false,
        rejectedHelloCount: 0,
        lastRejectedHelloAt: null,
        lastRejectedHelloReason: null,
      },
    });
  });

  it('rejects malformed tool descriptors', async () => {
    const malformedTool = await serveStatus({
      connected: true,
      extensionId: 'ext',
      tools: [{ name: '', description: 'bad', inputSchema: {} }],
      rejectedHelloCount: 1,
      lastRejectedHelloAt: Number.MAX_SAFE_INTEGER,
      lastRejectedHelloReason: 'bad-token',
    });

    await expect(fetchStatus(malformedTool, false)).rejects.toMatchObject({ code: 'protocol' });
  });

  it('normalizes an out-of-range diagnostic timestamp without throwing', async () => {
    const outOfRangeTimestamp = await serveStatus({
      connected: false,
      extensionId: null,
      tools: [],
      rejectedHelloCount: 1,
      lastRejectedHelloAt: Number.MAX_SAFE_INTEGER,
      lastRejectedHelloReason: 'bad-token',
    });

    await expect(fetchStatus(outOfRangeTimestamp, false)).resolves.toMatchObject({
      extension: { lastRejectedHelloAt: null, lastRejectedHelloReason: 'bad-token' },
    });
  });
});
