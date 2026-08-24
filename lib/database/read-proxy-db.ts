import { drizzle, type RemoteCallback } from 'drizzle-orm/pg-proxy';

import * as schema from './schema';
import { initializeDb } from './db-state';
import type { FavbaseDb } from './db-types';
import { createDbProxyClient } from './proxy-client';

/**
 * Build the read-only Drizzle client used by the Background SW.
 *
 * The regular PGlite Drizzle driver imports the complete PGlite runtime even
 * when handed an existing client. The Postgres proxy driver keeps query
 * building lightweight; this adapter restores PGlite's raw execute result
 * shape for the two SELECT-only Knowledge Tool queries that use db.execute().
 */
export function initReadDbProxy(
  ensureOffscreen?: () => Promise<void>,
): Promise<FavbaseDb> {
  return initializeDb(async () => {
    const proxy = await createDbProxyClient(ensureOffscreen);
    const callback: RemoteCallback = async (sql, params, method) => {
      const result = await proxy.query(sql, params, {
        rowMode: method === 'all' ? 'array' : 'object',
      });
      if (method === 'all') return { rows: result.rows };

      // pg-proxy normally unwraps `rows`; keep PGlite's QueryResult contract
      // because shared Chat retrieval reads `db.execute(...).rows`.
      return { rows: result as unknown as unknown[] };
    };
    return drizzle(callback, { schema }) as unknown as FavbaseDb;
  });
}
