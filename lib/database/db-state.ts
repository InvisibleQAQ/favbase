import type { PGlite } from '@electric-sql/pglite';

import type { FavbaseDb } from './db-types';

let dbInstance: FavbaseDb | null = null;
let initPromise: Promise<FavbaseDb> | null = null;
let pgliteInstance: PGlite | null = null;

/** Deduplicate initialization while keeping main/proxy construction behind one state owner. */
export function initializeDb(factory: () => Promise<FavbaseDb>): Promise<FavbaseDb> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (initPromise) return initPromise;

  initPromise = factory().then((db) => {
    dbInstance = db;
    return db;
  });
  return initPromise;
}

export function getDb(): FavbaseDb {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDbMain() or initDbProxy() first.');
  }
  return dbInstance;
}

export function setPGliteInstance(instance: PGlite): void {
  pgliteInstance = instance;
}

export function getPGliteInstance(): PGlite {
  if (!pgliteInstance) throw new Error('PGlite not available (proxy mode or not initialized)');
  return pgliteInstance;
}

export function hasPGliteInstance(): boolean {
  return pgliteInstance !== null;
}

export function resetDbState(): void {
  dbInstance = null;
  initPromise = null;
  pgliteInstance = null;
}
