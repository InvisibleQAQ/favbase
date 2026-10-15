import { useEffect, useState } from 'react';

import {
  getTaggingBudgetLedger,
  watchTaggingBudgetLedger,
  type TaggingBudgetLedger,
} from '@/lib/storage';
// The leaf, not the `@/lib/tagging` barrel: the barrel drags in the tagging
// service and the database.
import { taggingTokensSpentToday } from '@/lib/tagging/budget';

/**
 * Tokens automatic tagging has spent today on this device (docs/41), live from
 * the Tagging Budget ledger, for the LLM settings card and the collection
 * page's Tags segment. `null` while the ledger is unknown: still loading, or
 * the first read failed and no change has arrived since.
 */
export function useTaggingTokensSpentToday(): number | null {
  // `undefined` = not known yet; `null` = nothing ever recorded.
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

  // Derived on every render rather than stored, so a ledger from yesterday
  // reads as 0 today. No midnight timer: the next render picks up the new day.
  return ledger === undefined ? null : taggingTokensSpentToday(ledger, new Date());
}
