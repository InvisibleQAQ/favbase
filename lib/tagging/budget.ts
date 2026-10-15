/**
 * Tagging Budget arithmetic (docs/41): which local day a spend belongs to and
 * how much of the daily cap is left, plus the storage-backed port that
 * `tagPlatformItem` uses unless a test injects its own.
 */
import {
  chargeTaggingBudget,
  getTaggingBudgetLedger,
  settingsStorage,
  type TaggingBudgetLedger,
} from '@/lib/storage';

/** The seam `tagPlatformItem` checks before an LLM call and charges after it. */
export interface TaggingBudget {
  /** Tokens left today; a call may go out only while this is > 0. Rejects when the ledger is unreadable. */
  remaining(): Promise<number>;
  /** Record input + output tokens that were just spent. */
  charge(tokens: number): Promise<void>;
}

/**
 * Local calendar day as `YYYY-MM-DD`: the same local-day boundary the daily
 * automatic sync uses (`entrypoints/app/hooks/daily-sync-gate.ts`, which lib
 * may not import).
 */
export function localDayKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Tokens spent on `now`'s local day. A ledger from another day counts as nothing spent. */
export function taggingTokensSpentToday(ledger: TaggingBudgetLedger | null, now: Date): number {
  return ledger?.day === localDayKey(now) ? ledger.tokens : 0;
}

/** Cap minus today's spend; zero or below means today's budget is used up. */
export function remainingTaggingBudget(
  limit: number,
  ledger: TaggingBudgetLedger | null,
  now: Date,
): number {
  return limit - taggingTokensSpentToday(ledger, now);
}

/** Reads the cap on every check, so raising it takes effect in a run already under way. */
export const storageTaggingBudget: TaggingBudget = {
  async remaining() {
    const [settings, ledger] = await Promise.all([
      settingsStorage.getValue(),
      getTaggingBudgetLedger(),
    ]);
    return remainingTaggingBudget(settings.taggingDailyTokenBudget, ledger, new Date());
  },
  charge: (tokens) => chargeTaggingBudget(localDayKey(new Date()), tokens),
};
