import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from './schema';
import { createDbProxyClient } from './proxy-client';
import { initializeDb } from './db-state';
import type { FavbaseDb } from './db-types';

/** Initialize a caller-side Drizzle client over the Background/Offscreen Port RPC seam. */
export function initDbProxy(
  ensureOffscreen?: () => Promise<void>,
): Promise<FavbaseDb> {
  return initializeDb(async () => {
    const proxy = await createDbProxyClient(ensureOffscreen);
    return drizzle({ client: proxy as unknown as PGlite, schema });
  });
}
