import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  constructProxy: vi.fn(),
  drizzle: vi.fn(),
  waitReady: Promise.resolve(),
}));

vi.mock('./bridges/chrome-port-rpc', () => ({
  createChromePortTransport: mocks.createTransport,
}));
vi.mock('./bridges/proxy-driver', () => ({
  PGliteSharedProxy: class {
    readonly waitReady = mocks.waitReady;

    constructor(transport: unknown) {
      mocks.constructProxy(transport);
    }
  },
}));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: mocks.drizzle }));

describe('initDbProxy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.waitReady = Promise.resolve();
    mocks.createTransport.mockResolvedValue({ kind: 'transport' });
    mocks.drizzle.mockReturnValue({ kind: 'db' });
  });

  it('forwards ensureOffscreen and exposes the initialized database through getDb', async () => {
    const ensureOffscreen = vi.fn(async () => {});
    const { initDbProxy } = await import('./proxy-db');
    const { getDb } = await import('./db-state');

    expect(() => getDb()).toThrow('Database not initialized');
    const db = await initDbProxy(ensureOffscreen);

    expect(mocks.createTransport).toHaveBeenCalledWith({
      channelName: 'favbase-db',
      ensureOffscreen,
    });
    expect(mocks.constructProxy).toHaveBeenCalledWith({ kind: 'transport' });
    expect(getDb()).toBe(db);
  });

  it('waits for proxy readiness before constructing Drizzle', async () => {
    let resolveReady!: () => void;
    mocks.waitReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const { initDbProxy } = await import('./proxy-db');

    const pending = initDbProxy();
    await vi.waitFor(() => expect(mocks.constructProxy).toHaveBeenCalledOnce());
    expect(mocks.drizzle).not.toHaveBeenCalled();

    resolveReady();
    await pending;
    expect(mocks.drizzle).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent initialization', async () => {
    let resolveTransport!: (transport: { kind: string }) => void;
    mocks.createTransport.mockReturnValue(new Promise((resolve) => {
      resolveTransport = resolve;
    }));
    const { initDbProxy } = await import('./proxy-db');

    const first = initDbProxy();
    const second = initDbProxy();
    expect(mocks.createTransport).toHaveBeenCalledOnce();

    resolveTransport({ kind: 'transport' });
    const [firstDb, secondDb] = await Promise.all([first, second]);
    expect(firstDb).toBe(secondDb);
    expect(mocks.constructProxy).toHaveBeenCalledOnce();
    expect(mocks.drizzle).toHaveBeenCalledOnce();
  });
});
