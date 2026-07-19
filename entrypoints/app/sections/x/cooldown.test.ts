import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, remainingCooldown, formatCountdown } from './cooldown';

describe('remainingCooldown', () => {
  const NOW = 1_000_000_000;

  it('returns 0 when there was never a sync (null)', () => {
    expect(remainingCooldown(null, NOW)).toBe(0);
  });

  it('returns 0 outside the window (elapsed >= COOLDOWN_MS)', () => {
    expect(remainingCooldown(NOW - COOLDOWN_MS, NOW)).toBe(0);
    expect(remainingCooldown(NOW - COOLDOWN_MS - 1, NOW)).toBe(0);
    expect(remainingCooldown(NOW - 10 * COOLDOWN_MS, NOW)).toBe(0);
  });

  it('returns the remaining time inside the window', () => {
    // Synced 1 minute ago → 4 minutes left.
    expect(remainingCooldown(NOW - 60_000, NOW)).toBe(COOLDOWN_MS - 60_000);
  });

  it('returns the full window immediately after a sync (elapsed 0)', () => {
    expect(remainingCooldown(NOW, NOW)).toBe(COOLDOWN_MS);
  });

  it('boundary: 1ms before the window ends still returns a positive remainder', () => {
    const remaining = remainingCooldown(NOW - (COOLDOWN_MS - 1), NOW);
    expect(remaining).toBe(1);
  });

  it('boundary: exactly at the window end returns 0', () => {
    expect(remainingCooldown(NOW - COOLDOWN_MS, NOW)).toBe(0);
  });

  it('clock skew (sync time in the future): keeps the button locked', () => {
    expect(remainingCooldown(NOW + 10_000, NOW)).toBe(COOLDOWN_MS);
  });
});

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
