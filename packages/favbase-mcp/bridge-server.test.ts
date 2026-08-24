import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { BridgeCallError, BridgeServer } from './bridge-server';

const servers: BridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe('BridgeServer bounded waits', () => {
  it('rejects a call within the configured hello deadline', async () => {
    const server = new BridgeServer({
      port: 0,
      token: 'test-token',
      serverVersion: 'test',
      helloWaitMs: 40,
    });
    servers.push(server);
    await server.start();

    const startedAt = performance.now();
    await expect(server.callTool('searchKnowledgeBase', { query: 'favbase' }))
      .rejects.toMatchObject({
        code: 'extension-unavailable',
      });
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('honors cancellation while waiting for hello', async () => {
    const server = new BridgeServer({
      port: 0,
      token: 'test-token',
      serverVersion: 'test',
      helloWaitMs: 5_000,
    });
    servers.push(server);
    await server.start();

    const controller = new AbortController();
    const call = server.callTool('listTags', {}, controller.signal);
    controller.abort();

    await expect(call).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});
