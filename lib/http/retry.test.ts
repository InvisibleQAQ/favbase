import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrySignal, retryAfter, withRetries } from './retry';

describe('withRetries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the first non-signal value as-is, without sleeping', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const value = { json: 1 };
    const attempt = vi.fn(async () => value);

    await expect(withRetries({ maxRetries: 3 }, attempt)).resolves.toBe(value);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('lets a thrown error through untouched and never retries it', async () => {
    const boom = new Error('boom');
    const exhausted = vi.fn(() => new Error('spent'));
    let calls = 0;
    const attempt = vi.fn(async (): Promise<string | RetrySignal> => {
      calls += 1;
      if (calls === 1) return retryAfter(() => 10, exhausted);
      throw boom;
    });

    const run = withRetries({ maxRetries: 5 }, attempt);
    const assertion = expect(run).rejects.toBe(boom);
    await vi.runAllTimersAsync();
    await assertion;

    expect(attempt).toHaveBeenCalledTimes(2);
    expect(exhausted).not.toHaveBeenCalled();
  });

  it('retries exactly maxRetries times, then throws what exhausted builds, built once', async () => {
    const spent = new Error('spent');
    const exhausted = vi.fn(() => spent);
    const delayMs = vi.fn((retry: number) => retry * 100);
    const attempt = vi.fn(async () => retryAfter(delayMs, exhausted));

    const run = withRetries({ maxRetries: 3 }, attempt);
    const assertion = expect(run).rejects.toBe(spent);
    await vi.runAllTimersAsync();
    await assertion;

    expect(attempt).toHaveBeenCalledTimes(4);
    expect(exhausted).toHaveBeenCalledTimes(1);
    expect(delayMs.mock.calls.map(([retry]) => retry)).toEqual([1, 2, 3]);
  });

  it('awaits an async exhausted error', async () => {
    const spent = new Error('spent later');
    const attempt = async () => retryAfter(() => 1, async () => spent);

    const run = withRetries({ maxRetries: 1 }, attempt);
    const assertion = expect(run).rejects.toBe(spent);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('with maxRetries 0 throws on the first signal without computing a delay', async () => {
    const delayMs = vi.fn(() => 1000);
    const spent = new Error('spent');

    await expect(
      withRetries({ maxRetries: 0 }, async () => retryAfter(delayMs, () => spent)),
    ).rejects.toBe(spent);
    expect(delayMs).not.toHaveBeenCalled();
  });

  it('sleeps the signalled delay before the next attempt', async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? retryAfter(() => 1000, () => new Error('spent')) : 'ok';
    });

    const run = withRetries({ maxRetries: 2 }, attempt);
    await vi.advanceTimersByTimeAsync(999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('shares one budget across signals of different kinds and returns a mid-way success', async () => {
    const spentA = vi.fn(() => new Error('a'));
    const spentB = vi.fn(() => new Error('b'));
    const outcomes: Array<() => string | RetrySignal> = [
      () => retryAfter(() => 5, spentA),
      () => retryAfter(() => 7, spentB),
      () => 'done',
    ];
    let i = 0;
    const attempt = vi.fn(async () => outcomes[i++]());

    const run = withRetries({ maxRetries: 2 }, attempt);
    await vi.runAllTimersAsync();

    await expect(run).resolves.toBe('done');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(spentA).not.toHaveBeenCalled();
    expect(spentB).not.toHaveBeenCalled();
  });

  it('checks control before every attempt, the first included', async () => {
    const order: string[] = [];
    const checkpoint = vi.fn(async () => {
      order.push('checkpoint');
    });
    let calls = 0;
    const attempt = async () => {
      order.push('attempt');
      calls += 1;
      return calls < 3 ? retryAfter(() => 1, () => new Error('spent')) : 'ok';
    };

    const run = withRetries({ maxRetries: 5, control: { checkpoint } }, attempt);
    await vi.runAllTimersAsync();

    await expect(run).resolves.toBe('ok');
    expect(checkpoint).toHaveBeenCalledTimes(3);
    expect(order).toEqual(['checkpoint', 'attempt', 'checkpoint', 'attempt', 'checkpoint', 'attempt']);
  });

  it('stops before the attempt when the checkpoint rejects', async () => {
    const stopped = new Error('cancelled');
    const attempt = vi.fn(async () => 'ok');

    await expect(
      withRetries({ maxRetries: 1, control: { checkpoint: async () => Promise.reject(stopped) } }, attempt),
    ).rejects.toBe(stopped);
    expect(attempt).not.toHaveBeenCalled();
  });

  it('tells a signal from a platform value by class, not by shape', async () => {
    const lookalike = { delayMs: () => 1, exhausted: () => new Error('x') };

    await expect(withRetries({ maxRetries: 1 }, async () => lookalike)).resolves.toBe(lookalike);
  });
});
