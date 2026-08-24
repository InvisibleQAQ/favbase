import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';
import { runMigrations } from './migrations';
import { DB_DATA_DIR, DB_CHANNEL_NAME } from './constants';
import { DatabaseRpcHandler } from './bridges/rpc-handler';
import {
  getDb,
  getPGliteInstance,
  hasPGliteInstance,
  initializeDb,
  resetDbState,
  setPGliteInstance,
} from './db-state';
import type { FavbaseDb } from './db-types';

export type { FavbaseDb } from './db-types';
export { initDbProxy } from './proxy-db';

export async function initDbMain(): Promise<FavbaseDb> {
  return initializeDb(async () => {
    const handler = DatabaseRpcHandler.getInstance();
    handler.startListening(DB_CHANNEL_NAME);
    try {
      const pg = await PGlite.create(DB_DATA_DIR, {
        extensions: { vector, uuid_ossp, pg_trgm },
        relaxedDurability: false,
      });
      setPGliteInstance(pg);

      await runMigrations(pg);

      handler.setPGlite(pg);

      return drizzle({ client: pg, schema });
    } catch (err) {
      await handler.stop();
      throw err;
    }
  });
}

export function getPGlite(): PGlite {
  return getPGliteInstance();
}

export async function closeDb(): Promise<void> {
  if (hasPGliteInstance()) {
    const pgliteInstance = getPGliteInstance();
    await DatabaseRpcHandler.getInstance().stop();
    await pgliteInstance.close();
  }
  resetDbState();
}

export { getDb };
