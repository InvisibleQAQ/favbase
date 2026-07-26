import { describe, expect, it } from 'vitest';

import { isSameLocalDay, shouldAutoSync } from './daily-sync-gate';

describe('isSameLocalDay', () => {
  it('is true for two different times on the same calendar day', () => {
    const morning = new Date(2026, 6, 26, 8, 30, 0);
    const evening = new Date(2026, 6, 26, 23, 59, 59);
    expect(isSameLocalDay(morning, evening)).toBe(true);
  });

  it('is false across a day boundary', () => {
    const late = new Date(2026, 6, 26, 23, 59, 0);
    const nextDay = new Date(2026, 6, 27, 0, 1, 0);
    expect(isSameLocalDay(late, nextDay)).toBe(false);
  });

  it('is false across a month boundary', () => {
    const endOfJuly = new Date(2026, 6, 31, 12, 0, 0);
    const startOfAugust = new Date(2026, 7, 1, 12, 0, 0);
    expect(isSameLocalDay(endOfJuly, startOfAugust)).toBe(false);
  });

  it('is false across a year boundary', () => {
    const endOfYear = new Date(2026, 11, 31, 23, 0, 0);
    const newYear = new Date(2027, 0, 1, 1, 0, 0);
    expect(isSameLocalDay(endOfYear, newYear)).toBe(false);
  });
});

describe('shouldAutoSync', () => {
  const now = new Date(2026, 6, 26, 10, 0, 0);

  it('returns true when never synced (null)', () => {
    expect(shouldAutoSync(null, now)).toBe(true);
  });

  it('returns false when already synced earlier today', () => {
    const earlierToday = new Date(2026, 6, 26, 2, 0, 0);
    expect(shouldAutoSync(earlierToday, now)).toBe(false);
  });

  it('returns true when last sync was yesterday', () => {
    const yesterday = new Date(2026, 6, 25, 23, 0, 0);
    expect(shouldAutoSync(yesterday, now)).toBe(true);
  });

  it('returns true when last sync was last month', () => {
    const lastMonth = new Date(2026, 5, 26, 10, 0, 0);
    expect(shouldAutoSync(lastMonth, now)).toBe(true);
  });

  it('returns true when last sync was last year', () => {
    const lastYear = new Date(2025, 6, 26, 10, 0, 0);
    expect(shouldAutoSync(lastYear, now)).toBe(true);
  });
});
