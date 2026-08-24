import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { tags } from './schema';

const mocks = vi.hoisted(() => ({
  createProxy: vi.fn(),
  query: vi.fn(),
}));

vi.mock('./proxy-client', () => ({
  createDbProxyClient: mocks.createProxy,
}));

describe('initReadDbProxy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createProxy.mockResolvedValue({ query: mocks.query });
  });

  it('maps query-builder rows and preserves the PGlite raw execute result shape', async () => {
    const fields = [{ name: 'count', dataTypeID: 23 }];
    mocks.query
      .mockResolvedValueOnce({ rows: [['tag-1']] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }], fields, affectedRows: 0 });
    const ensureOffscreen = vi.fn(async () => {});
    const { initReadDbProxy } = await import('./read-proxy-db');

    const db = await initReadDbProxy(ensureOffscreen);
    const selected = await db.select({ id: tags.id }).from(tags);
    const raw = await db.execute<{ count: number }>(sql`select 1 as count`);

    expect(mocks.createProxy).toHaveBeenCalledWith(ensureOffscreen);
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('from "tags"'),
      [],
      { rowMode: 'array' },
    );
    expect(selected).toEqual([{ id: 'tag-1' }]);
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      'select 1 as count',
      [],
      { rowMode: 'object' },
    );
    expect(raw).toEqual({ rows: [{ count: 1 }], fields, affectedRows: 0 });
  });
});
