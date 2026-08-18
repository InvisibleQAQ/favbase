import { describe, it, expect } from 'vitest';
import { sleep, jitteredDelayMs, backoffDelayMs } from './backoff';

describe('jitteredDelayMs', () => {
  it('spans [base, base + jitter] across the random range', () => {
    expect(jitteredDelayMs(1000, 500, () => 0)).toBe(1000);
    expect(jitteredDelayMs(1000, 500, () => 0.5)).toBe(1250);
    expect(jitteredDelayMs(1000, 500, () => 1)).toBe(1500);
  });

  it('defaults to Math.random within the range', () => {
    const v = jitteredDelayMs(1000, 500);
    expect(v).toBeGreaterThanOrEqual(1000);
    expect(v).toBeLessThanOrEqual(1500);
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt from base (1-based attempt)', () => {
    expect(backoffDelayMs(1, 1000, 500, () => 0)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 500, () => 0)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 500, () => 0)).toBe(4000);
  });

  it('adds jitter on top of the exponential term', () => {
    expect(backoffDelayMs(2, 1000, 500, () => 1)).toBe(2500);
  });
});

describe('sleep', () => {
  it('resolves', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
