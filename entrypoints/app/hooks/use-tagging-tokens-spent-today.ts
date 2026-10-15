import { useEffect, useState } from 'react';

import { useSettings } from '@/lib/hooks/useSettings';
import {
  getTaggingBudgetLedger,
  watchTaggingBudgetLedger,
  type TaggingBudgetLedger,
} from '@/lib/storage';
import { resolveLlmConfig } from '@/lib/storage/resolve';
// The leaf, not the `@/lib/tagging` barrel: the barrel drags in the tagging
// service and the database.
import { remainingTaggingBudget, taggingTokensSpentToday } from '@/lib/tagging/budget';

/**
 * The Tagging Budget ledger, live: `undefined` while not known yet (still
 * loading, or the first read failed and no change has arrived since), `null`
 * when nothing was ever recorded.
 */
function useTaggingBudgetLedger(): TaggingBudgetLedger | null | undefined {
  const [ledger, setLedger] = useState<TaggingBudgetLedger | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let watched = false;

    // Subscribe before reading: a charge that lands between the read and the
    // subscription would otherwise be missed until the next one.
    const unwatch = watchTaggingBudgetLedger((next) => {
      watched = true;
      if (active) setLedger(next);
    });

    getTaggingBudgetLedger()
      .then((initial) => {
        // A watch delivery is newer than whatever this read saw.
        if (active && !watched) setLedger(initial);
      })
      .catch((err: unknown) => {
        console.warn('[tagging-budget] Failed to read the ledger:', err);
      });

    return () => {
      active = false;
      unwatch();
    };
  }, []);

  return ledger;
}

/**
 * Tokens automatic tagging has spent today on this device (docs/41), live from
 * the Tagging Budget ledger, for the LLM settings card. `null` while the ledger
 * is unknown.
 */
export function useTaggingTokensSpentToday(): number | null {
  const ledger = useTaggingBudgetLedger();
  // Derived on every render rather than stored, so a ledger from yesterday
  // reads as 0 today. No midnight timer: the next render picks up the new day.
  return ledger === undefined ? null : taggingTokensSpentToday(ledger, new Date());
}

/**
 * Today's spend once it has reached the user's saved daily limit, else `null`
 * (docs/41 D8), for the collection page's Tags segment and notice.
 *
 * Also `null` while settings or the ledger are unknown, and while the LLM is
 * not configured: then missing configuration is what holds the items, the
 * Configuration Blocker says so, and `tagPlatformItem` checks configuration
 * before it reads the ledger too.
 */
export function useTaggingBudgetReachedSpend(): number | null {
  const ledger = useTaggingBudgetLedger();
  const { settings, loading } = useSettings();
  if (loading || ledger === undefined || !resolveLlmConfig(settings).enabled) return null;

  const now = new Date();
  return remainingTaggingBudget(settings.taggingDailyTokenBudget, ledger, now) <= 0
    ? taggingTokensSpentToday(ledger, now)
    : null;
}
