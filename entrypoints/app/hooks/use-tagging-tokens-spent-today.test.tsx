// @vitest-environment happy-dom

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaggingBudgetLedger } from '@/lib/storage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getTaggingBudgetLedger: vi.fn<() => Promise<TaggingBudgetLedger | null>>(),
  watchers: [] as Array<(ledger: TaggingBudgetLedger | null) => void>,
  unwatch: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getTaggingBudgetLedger: mocks.getTaggingBudgetLedger,
  watchTaggingBudgetLedger: vi.fn((callback: (ledger: TaggingBudgetLedger | null) => void) => {
    mocks.watchers.push(callback);
    return mocks.unwatch;
  }),
  chargeTaggingBudget: vi.fn(),
  settingsStorage: { getValue: vi.fn() },
}));

import { useTaggingTokensSpentToday } from './use-tagging-tokens-spent-today';

const TODAY = '2026-10-15';
const YESTERDAY = '2026-10-14';

function Probe() {
  const spent = useTaggingTokensSpentToday();
  return <output data-spent>{spent === null ? 'null' : String(spent)}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useTaggingTokensSpentToday', () => {
  let container: HTMLDivElement;
  let root: Root;

  const spent = () => container.querySelector('[data-spent]')?.textContent;
  const push = (ledger: TaggingBudgetLedger | null) =>
    act(() => {
      for (const watcher of mocks.watchers) watcher(ledger);
    });

  beforeEach(() => {
    // Only Date is faked: React's scheduler and the awaited reads stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
    mocks.getTaggingBudgetLedger.mockReset();
    mocks.watchers.length = 0;
    mocks.unwatch.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns today's spend from the ledger", async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue({ day: TODAY, tokens: 1234 });

    await act(async () => root.render(<Probe />));

    expect(spent()).toBe('1234');
  });

  it('reads a ledger from another day as nothing spent', async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue({ day: YESTERDAY, tokens: 9_999_999 });

    await act(async () => root.render(<Probe />));

    expect(spent()).toBe('0');
  });

  it('reads an absent ledger as nothing spent', async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue(null);

    await act(async () => root.render(<Probe />));

    expect(spent()).toBe('0');
  });

  it('follows ledger changes pushed by the watch', async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue({ day: TODAY, tokens: 100 });
    await act(async () => root.render(<Probe />));

    push({ day: TODAY, tokens: 500 });

    expect(spent()).toBe('500');
  });

  it('does not let a slower initial read overwrite a value the watch already delivered', async () => {
    const initial = deferred<TaggingBudgetLedger | null>();
    mocks.getTaggingBudgetLedger.mockReturnValue(initial.promise);
    await act(async () => root.render(<Probe />));
    expect(spent()).toBe('null');

    push({ day: TODAY, tokens: 900 });
    await act(async () => initial.resolve({ day: TODAY, tokens: 100 }));

    expect(spent()).toBe('900');
  });

  it('returns null and warns when the initial read rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getTaggingBudgetLedger.mockRejectedValue(new Error('storage unavailable'));

    await act(async () => root.render(<Probe />));

    expect(spent()).toBe('null');
    expect(warn).toHaveBeenCalled();
  });

  it('recovers from a failed initial read once the watch delivers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getTaggingBudgetLedger.mockRejectedValue(new Error('storage unavailable'));
    await act(async () => root.render(<Probe />));

    push({ day: TODAY, tokens: 42 });

    expect(spent()).toBe('42');
  });

  // app.html mounts under StrictMode: the first subscription is torn down and
  // a second one made, and only the live one may drive the value.
  it('survives the StrictMode double mount', async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue({ day: TODAY, tokens: 100 });

    await act(async () =>
      root.render(
        <StrictMode>
          <Probe />
        </StrictMode>,
      ),
    );
    expect(spent()).toBe('100');
    expect(mocks.unwatch).toHaveBeenCalledOnce();

    push({ day: TODAY, tokens: 700 });

    expect(spent()).toBe('700');
  });

  it('stops watching on unmount', async () => {
    mocks.getTaggingBudgetLedger.mockResolvedValue(null);
    await act(async () => root.render(<Probe />));

    act(() => root.render(<></>));

    expect(mocks.unwatch).toHaveBeenCalledOnce();
  });
});
