// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCountdown, useCountdown } from './use-countdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date('2026-09-30T10:00:00Z').getTime();

describe('useCountdown', () => {
  let container: HTMLDivElement;
  let root: Root;
  /** Every value the hook returned, in render order. */
  let seen: number[];
  /** Epoch ms the probe counts down to; null = nothing to count down to. */
  let deadline: number | null;

  function Probe() {
    seen.push(useCountdown((now) => (deadline === null ? 0 : deadline - now)));
    return null;
  }

  function render(): void {
    act(() => root.render(createElement(Probe)));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    seen = [];
    deadline = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('schedules no interval while nothing remains', () => {
    render();
    expect(seen.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts down once a second and stops the interval at 0', () => {
    deadline = T0 + 3_000;
    render();
    expect(seen.at(-1)).toBe(3_000);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(seen.at(-1)).toBe(2_000);
    act(() => vi.advanceTimersByTime(1_000));
    expect(seen.at(-1)).toBe(1_000);
    act(() => vi.advanceTimersByTime(1_000));
    expect(seen.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Nothing ticks after the countdown ended.
    const renders = seen.length;
    act(() => vi.advanceTimersByTime(10_000));
    expect(seen.length).toBe(renders);
  });

  it('measures a deadline that appears long after mount from the current time', () => {
    // Regression for a `now` kept in state since mount: with nothing to count
    // down to no interval ticks, so such a `now` would stay at T0 and the new
    // deadline would read 10 minutes too long on its first frame.
    render();
    act(() => vi.advanceTimersByTime(10 * 60_000));

    deadline = Date.now() + 5_000;
    render();
    expect(seen.at(-1)).toBe(5_000);
  });

  it('never returns a negative remainder', () => {
    deadline = T0 - 1_000;
    render();
    expect(seen.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Moved from sections/x/cooldown.test.ts with the function (docs/32 Step 4).
describe('formatCountdown', () => {
  it('formats mm:ss with zero-padded seconds', () => {
    expect(formatCountdown(5 * 60 * 1000)).toBe('5:00');
    expect(formatCountdown(4 * 60 * 1000 + 30 * 1000)).toBe('4:30');
    expect(formatCountdown(9 * 1000)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('rounds up partial seconds so the label never shows 0:00 while time remains', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
  });
});
