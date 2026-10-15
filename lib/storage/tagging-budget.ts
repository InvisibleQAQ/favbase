/**
 * The Tagging Budget ledger (docs/41 D5): how many input + output tokens
 * automatic tagging has spent on this device's current local day. This module
 * is the only reader and writer of the ledger key. The daily cap lives in
 * settings; what the numbers mean (remaining, the day boundary) is lib/tagging's.
 */
import { storage } from 'wxt/utils/storage';
import { STORAGE_KEYS } from './keys';

export interface TaggingBudgetLedger {
  /** Local calendar day the tokens were spent on, `YYYY-MM-DD`. */
  day: string;
  /** Input + output tokens charged on `day`. */
  tokens: number;
}

/** Every charge from every page of this extension's origin queues on this lock. */
const LEDGER_LOCK = 'favbase:tagging-budget-ledger';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function defineLedgerItem() {
  return storage.defineItem<unknown>(STORAGE_KEYS.taggingBudgetLedger, { fallback: null });
}

let ledgerItem: ReturnType<typeof defineLedgerItem> | null = null;

/** Lazily defined for the same reason as `settings.ts`: importing must not touch `chrome.runtime`. */
function ledgerStorage(): ReturnType<typeof defineLedgerItem> {
  ledgerItem ??= defineLedgerItem();
  return ledgerItem;
}

function isLedger(raw: unknown): raw is TaggingBudgetLedger {
  if (typeof raw !== 'object' || raw === null) return false;
  const { day, tokens } = raw as Record<string, unknown>;
  return (
    typeof day === 'string' &&
    DAY_PATTERN.test(day) &&
    typeof tokens === 'number' &&
    Number.isFinite(tokens) &&
    tokens >= 0
  );
}

/**
 * A malformed value reads as `null` (nothing spent), never as exhausted: a
 * deferred item never charges, so garbage read as "spent" would block tagging
 * until someone cleared storage by hand. The next charge overwrites it.
 */
function decodeLedger(raw: unknown): TaggingBudgetLedger | null {
  if (raw === null || raw === undefined) return null;
  if (isLedger(raw)) return { day: raw.day, tokens: raw.tokens };
  console.warn('[tagging-budget] Ignoring a malformed ledger:', raw);
  return null;
}

/** Rejects when storage cannot be read; the caller decides what that means. */
export async function getTaggingBudgetLedger(): Promise<TaggingBudgetLedger | null> {
  return decodeLedger(await ledgerStorage().getValue());
}

export function watchTaggingBudgetLedger(
  callback: (ledger: TaggingBudgetLedger | null) => void,
): () => void {
  return ledgerStorage().watch((next) => callback(decodeLedger(next)));
}

/**
 * Add `tokens` to `day`'s spend; a ledger from another day restarts at zero.
 * The read-modify-write runs under a Web Lock because two app.html tabs can
 * charge at once. Without `navigator.locks` this rejects: it never runs unlocked.
 * A zero, negative or non-finite charge is a no-op.
 */
export async function chargeTaggingBudget(day: string, tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  await navigator.locks.request(LEDGER_LOCK, async () => {
    const previous = await getTaggingBudgetLedger();
    const spent = previous?.day === day ? previous.tokens : 0;
    await ledgerStorage().setValue({ day, tokens: spent + tokens });
  });
}
