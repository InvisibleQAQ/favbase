import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';
import { runMigrations } from './migrations';
import { DB_DATA_DIR, DB_CHANNEL_NAME } from './constants';
import { DatabaseRpcHandler } from './bridges/rpc-handler';
import { PGliteSharedProxy } from './bridges/proxy-driver';
import { createChromePortTransport } from './bridges/chrome-port-rpc';

export type FavbaseDb = ReturnType<typeof drizzle<typeof schema>>;

let pgliteInstance: PGlite | null = null;
let dbInstance: FavbaseDb | null = null;
let initPromise: Promise<FavbaseDb> | null = null;

export async function initDbMain(): Promise<FavbaseDb> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  const handler = DatabaseRpcHandler.getInstance();
  handler.startListening(DB_CHANNEL_NAME);

  initPromise = (async () => {
    try {
      const pg = await PGlite.create(DB_DATA_DIR, {
        extensions: { vector, uuid_ossp, pg_trgm },
        relaxedDurability: true,
      });
      pgliteInstance = pg;

      await runMigrations(pg);

      handler.setPGlite(pg);

      dbInstance = drizzle({ client: pg, schema });
      return dbInstance;
    } catch (err) {
      handler.stop();
      throw err;
    }
  })();

  return initPromise;
}

export async function initDbProxy(
  ensureOffscreen?: () => Promise<void>,
): Promise<FavbaseDb> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const transport = await createChromePortTransport({
      channelName: DB_CHANNEL_NAME,
      ensureOffscreen,
    });

    const proxy = new PGliteSharedProxy(transport);
    await proxy.waitReady;

    dbInstance = drizzle({ client: proxy as unknown as PGlite, schema });
    return dbInstance;
  })();

  return initPromise;
}

export function getDb(): FavbaseDb {
  if (!dbInstance) throw new Error('Database not initialized. Call initDbMain() or initDbProxy() first.');
  return dbInstance;
}

export function getPGlite(): PGlite {
  if (!pgliteInstance) throw new Error('PGlite not available (proxy mode or not initialized)');
  return pgliteInstance;
}

export async function closeDb(): Promise<void> {
  if (pgliteInstance) {
    DatabaseRpcHandler.getInstance().stop();
    await pgliteInstance.close();
    pgliteInstance = null;
  }
  dbInstance = null;
  initPromise = null;
}
