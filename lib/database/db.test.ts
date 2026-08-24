import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  drizzle: vi.fn(() => ({ kind: 'db' })),
  runMigrations: vi.fn(),
  startListening: vi.fn(),
  setPGlite: vi.fn(),
  stop: vi.fn(async () => {}),
  vector: { name: 'vector' },
  uuidOssp: { name: 'uuid-ossp' },
  pgTrgm: { name: 'pg-trgm' },
}));

vi.mock('@electric-sql/pglite', () => ({ PGlite: { create: mocks.create } }));
vi.mock('@electric-sql/pglite-pgvector', () => ({ vector: mocks.vector }));
vi.mock('@electric-sql/pglite/contrib/uuid_ossp', () => ({ uuid_ossp: mocks.uuidOssp }));
vi.mock('@electric-sql/pglite/contrib/pg_trgm', () => ({ pg_trgm: mocks.pgTrgm }));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: mocks.drizzle }));
vi.mock('./migrations', () => ({ runMigrations: mocks.runMigrations }));
vi.mock('./bridges/rpc-handler', () => ({
  DatabaseRpcHandler: {
    getInstance: () => ({
      startListening: mocks.startListening,
      setPGlite: mocks.setPGlite,
      stop: mocks.stop,
    }),
  },
}));
vi.mock('./bridges/proxy-driver', () => ({ PGliteSharedProxy: vi.fn() }));
vi.mock('./bridges/chrome-port-rpc', () => ({ createChromePortTransport: vi.fn() }));

describe('initDbMain durability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('opens the persistent database with relaxed durability disabled', async () => {
    const pg = { close: vi.fn(async () => {}) };
    mocks.create.mockResolvedValue(pg);
    const { initDbMain, closeDb } = await import('./db');

    await initDbMain();

    expect(mocks.create).toHaveBeenCalledWith(
      'idb://favbase',
      expect.objectContaining({
        relaxedDurability: false,
        extensions: {
          vector: mocks.vector,
          uuid_ossp: mocks.uuidOssp,
          pg_trgm: mocks.pgTrgm,
        },
      }),
    );
    await closeDb();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(pg.close).toHaveBeenCalledOnce();
  });

  it('registers the RPC listener synchronously and deduplicates concurrent initialization', async () => {
    let resolveCreate!: (pg: { close(): Promise<void> }) => void;
    const pg = { close: vi.fn(async () => {}) };
    mocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const { initDbMain, closeDb } = await import('./db');

    const first = initDbMain();
    const second = initDbMain();

    expect(mocks.startListening).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();

    resolveCreate(pg);
    const [firstDb, secondDb] = await Promise.all([first, second]);
    expect(firstDb).toBe(secondDb);
    expect(mocks.runMigrations).toHaveBeenCalledOnce();

    await closeDb();
  });
});
