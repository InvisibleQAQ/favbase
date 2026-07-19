import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stub of WXT's storage.defineItem — the real implementation needs a
// browser extension context (chrome.storage), which vitest lacks. We only need
// getValue/setValue round-trip fidelity + fallback semantics here.
vi.mock('wxt/utils/storage', () => {
  const store = new Map<string, unknown>();
  return {
    storage: {
      defineItem<T>(key: string, opts?: { fallback?: T }) {
        return {
          async getValue(): Promise<T> {
            return (store.has(key) ? store.get(key) : opts?.fallback) as T;
          },
          async setValue(value: T): Promise<void> {
            store.set(key, value);
          },
          async removeValue(): Promise<void> {
            store.delete(key);
          },
        };
      },
    },
    __store: store,
  };
});

import { xLastSyncStorage, type XLastSync } from './ui-state';

describe('xLastSyncStorage', () => {
  beforeEach(async () => {
    await xLastSyncStorage.removeValue();
  });

  it('defaults to null before any sync (legacy libraries omit the "new" segment)', async () => {
    expect(await xLastSyncStorage.getValue()).toBeNull();
  });

  it('round-trips a sync summary', async () => {
    const summary: XLastSync = { syncedAt: 1_700_000_000_000, inserted: 42 };
    await xLastSyncStorage.setValue(summary);
    expect(await xLastSyncStorage.getValue()).toEqual(summary);
  });

  it('overwrites the previous summary with the newest run', async () => {
    await xLastSyncStorage.setValue({ syncedAt: 1, inserted: 3 });
    await xLastSyncStorage.setValue({ syncedAt: 2, inserted: 0 });
    expect(await xLastSyncStorage.getValue()).toEqual({ syncedAt: 2, inserted: 0 });
  });
});
