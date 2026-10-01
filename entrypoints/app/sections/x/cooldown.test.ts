import { describe, expect, it } from 'vitest';
import { COOLDOWN_MS, remainingCooldown } from './cooldown';

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
