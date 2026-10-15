import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Functional mocks: these ARE the two storage reads and the one write the
// default Tagging Budget port makes.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getTaggingBudgetLedger: vi.fn(),
  chargeTaggingBudget: vi.fn(),
}));

import { chargeTaggingBudget, getTaggingBudgetLedger, settingsStorage } from '@/lib/storage';
import {
  localDayKey,
  remainingTaggingBudget,
  storageTaggingBudget,
  taggingTokensSpentToday,
} from './budget';

describe('localDayKey', () => {
  it('names the local calendar day, zero-padded', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 9, 15, 0, 0, 0))).toBe('2026-10-15');
  });

  it('turns over at local midnight', () => {
    const lastSecond = new Date(2026, 9, 15, 23, 59, 59);
    const nextDay = new Date(2026, 9, 16, 0, 0, 0);
    expect(localDayKey(lastSecond)).not.toBe(localDayKey(nextDay));
  });
});

describe('taggingTokensSpentToday', () => {
  const now = new Date(2026, 9, 15, 12, 0, 0);

  it("reads today's ledger and treats any other day as zero", () => {
    expect(taggingTokensSpentToday(null, now)).toBe(0);
    expect(taggingTokensSpentToday({ day: '2026-10-15', tokens: 42 }, now)).toBe(42);
    expect(taggingTokensSpentToday({ day: '2026-10-14', tokens: 42 }, now)).toBe(0);
  });
});

describe('remainingTaggingBudget', () => {
  const now = new Date(2026, 9, 15, 12, 0, 0);
  const limit = 1_000;

  it('is the whole cap before anything has been charged', () => {
    expect(remainingTaggingBudget(limit, null, now)).toBe(1_000);
  });

  it("subtracts today's spend", () => {
    expect(remainingTaggingBudget(limit, { day: '2026-10-15', tokens: 300 }, now)).toBe(700);
  });

  it("resets to the whole cap on a new local day, whatever yesterday spent", () => {
    expect(remainingTaggingBudget(limit, { day: '2026-10-14', tokens: 5_000 }, now)).toBe(1_000);
  });

  it('goes to zero or below once the cap is spent (the check is remaining > 0)', () => {
    expect(remainingTaggingBudget(limit, { day: '2026-10-15', tokens: 1_000 }, now)).toBe(0);
    expect(remainingTaggingBudget(limit, { day: '2026-10-15', tokens: 1_250 }, now)).toBe(-250);
  });
});

describe('storageTaggingBudget (default port)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 9, 30, 0));
    vi.mocked(settingsStorage.getValue).mockReset();
    vi.mocked(getTaggingBudgetLedger).mockReset();
    vi.mocked(chargeTaggingBudget).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the cap from settings on every check, so a raised cap applies mid-run', async () => {
    vi.mocked(getTaggingBudgetLedger).mockResolvedValue({ day: '2026-10-15', tokens: 400 });
    vi.mocked(settingsStorage.getValue)
      .mockResolvedValueOnce({ taggingDailyTokenBudget: 1_000 } as never)
      .mockResolvedValueOnce({ taggingDailyTokenBudget: 5_000 } as never);

    await expect(storageTaggingBudget.remaining()).resolves.toBe(600);
    await expect(storageTaggingBudget.remaining()).resolves.toBe(4_600);
  });

  it("ignores yesterday's ledger", async () => {
    vi.mocked(getTaggingBudgetLedger).mockResolvedValue({ day: '2026-10-14', tokens: 9_999 });
    vi.mocked(settingsStorage.getValue).mockResolvedValue({ taggingDailyTokenBudget: 1_000 } as never);

    await expect(storageTaggingBudget.remaining()).resolves.toBe(1_000);
  });

  it('rejects when the ledger cannot be read', async () => {
    vi.mocked(getTaggingBudgetLedger).mockRejectedValue(new Error('storage down'));
    vi.mocked(settingsStorage.getValue).mockResolvedValue({ taggingDailyTokenBudget: 1_000 } as never);

    await expect(storageTaggingBudget.remaining()).rejects.toThrow('storage down');
  });

  it("charges today's local day", async () => {
    vi.mocked(chargeTaggingBudget).mockResolvedValue();

    await storageTaggingBudget.charge(321);

    expect(chargeTaggingBudget).toHaveBeenCalledWith('2026-10-15', 321);
  });
});
