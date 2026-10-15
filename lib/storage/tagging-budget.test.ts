import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the one WXT item the ledger module defines. `getValue`
// yields a macrotask, so a read-modify-write that is not serialized would
// interleave and lose an update — which is what the lock test relies on.
const store = vi.hoisted(() => {
  let value: unknown = null;
  const watchers = new Set<(next: unknown, prev: unknown) => void>();
  const item = {
    getValue: vi.fn(async (): Promise<unknown> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return value;
    }),
    setValue: vi.fn(async (next: unknown): Promise<void> => {
      const prev = value;
      value = next;
      for (const watcher of watchers) watcher(next, prev);
    }),
    watch: vi.fn((callback: (next: unknown, prev: unknown) => void) => {
      watchers.add(callback);
      return () => watchers.delete(callback);
    }),
  };
  return {
    item,
    reset(initial: unknown = null) {
      value = initial;
      watchers.clear();
      item.getValue.mockClear();
      item.setValue.mockClear();
      item.watch.mockClear();
    },
    peek: () => value,
  };
});

vi.mock('wxt/utils/storage', () => ({
  storage: { defineItem: vi.fn(() => store.item) },
}));

import { STORAGE_KEYS } from './keys';
import {
  chargeTaggingBudget,
  getTaggingBudgetLedger,
  watchTaggingBudgetLedger,
} from './tagging-budget';

/** A Web Locks stand-in that runs same-name requests one after another. */
function serialLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const run = tail.then(() => callback());
      tail = run.catch(() => undefined);
      return run;
    }),
  };
}

let locks: ReturnType<typeof serialLocks>;

beforeEach(() => {
  store.reset();
  locks = serialLocks();
  vi.stubGlobal('navigator', { locks });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Tagging Budget ledger storage', () => {
  it('is one device-local key, defined only on first use', async () => {
    expect(STORAGE_KEYS.taggingBudgetLedger).toBe('local:tagging-budget-ledger');

    vi.resetModules();
    const { storage } = await import('wxt/utils/storage');
    const ledger = await import('./tagging-budget');
    expect(storage.defineItem).not.toHaveBeenCalled();

    await ledger.getTaggingBudgetLedger();
    expect(storage.defineItem).toHaveBeenCalledWith('local:tagging-budget-ledger', {
      fallback: null,
    });
  });

  it('reads null before anything has been charged', async () => {
    await expect(getTaggingBudgetLedger()).resolves.toBeNull();
  });

  it('reads a stored ledger as is', async () => {
    store.reset({ day: '2026-10-15', tokens: 1_234 });
    await expect(getTaggingBudgetLedger()).resolves.toEqual({ day: '2026-10-15', tokens: 1_234 });
  });

  it.each([
    ['a string', 'garbage'],
    ['a numeric day', { day: 20261015, tokens: 10 }],
    ['a non-date day', { day: 'today', tokens: 10 }],
    ['negative tokens', { day: '2026-10-15', tokens: -5 }],
    ['non-numeric tokens', { day: '2026-10-15', tokens: '10' }],
  ])('reads a malformed ledger (%s) as no usage, with a warning', async (_, raw) => {
    // Not "exhausted": a deferred item never charges, so reading garbage as
    // spent would block tagging until someone cleared storage by hand.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.reset(raw);

    await expect(getTaggingBudgetLedger()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('lets a failed storage read reject (the caller decides what that means)', async () => {
    store.item.getValue.mockRejectedValueOnce(new Error('storage down'));
    await expect(getTaggingBudgetLedger()).rejects.toThrow('storage down');
  });

  it('adds a charge to the same day', async () => {
    store.reset({ day: '2026-10-15', tokens: 100 });
    await chargeTaggingBudget('2026-10-15', 250);
    expect(store.peek()).toEqual({ day: '2026-10-15', tokens: 350 });
  });

  it('starts a new day from zero', async () => {
    store.reset({ day: '2026-10-14', tokens: 4_999_999 });
    await chargeTaggingBudget('2026-10-15', 250);
    expect(store.peek()).toEqual({ day: '2026-10-15', tokens: 250 });
  });

  it('overwrites a malformed ledger on the next charge', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.reset('garbage');
    await chargeTaggingBudget('2026-10-15', 80);
    expect(store.peek()).toEqual({ day: '2026-10-15', tokens: 80 });
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores a charge of %s without touching storage or the lock',
    async (tokens) => {
      store.reset({ day: '2026-10-15', tokens: 100 });
      await chargeTaggingBudget('2026-10-15', tokens);
      expect(store.item.setValue).not.toHaveBeenCalled();
      expect(locks.request).not.toHaveBeenCalled();
      expect(store.peek()).toEqual({ day: '2026-10-15', tokens: 100 });
    },
  );

  it('serializes concurrent charges under one Web Lock, so no update is lost', async () => {
    // Two app.html tabs can run tag lanes at the same time (docs/41 D5).
    await Promise.all([
      chargeTaggingBudget('2026-10-15', 100),
      chargeTaggingBudget('2026-10-15', 50),
      chargeTaggingBudget('2026-10-15', 7),
    ]);

    expect(store.peek()).toEqual({ day: '2026-10-15', tokens: 157 });
    expect(locks.request).toHaveBeenCalledTimes(3);
    const names = new Set(locks.request.mock.calls.map(([name]) => name));
    expect(names.size).toBe(1);
  });

  it('refuses to charge without navigator.locks instead of running unlocked', async () => {
    vi.stubGlobal('navigator', {});
    await expect(chargeTaggingBudget('2026-10-15', 10)).rejects.toThrow();
    expect(store.item.setValue).not.toHaveBeenCalled();
  });

  it('watches decoded ledgers and stops on unwatch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    const unwatch = watchTaggingBudgetLedger((ledger) => seen.push(ledger));

    await chargeTaggingBudget('2026-10-15', 40);
    await store.item.setValue('garbage');
    unwatch();
    await chargeTaggingBudget('2026-10-15', 1);

    expect(seen).toEqual([{ day: '2026-10-15', tokens: 40 }, null]);
  });
});
