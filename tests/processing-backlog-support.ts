/**
 * Test support only — no runtime module imports this file (same convention as
 * tests/ingest-test-support.ts).
 *
 * A Platform Sync ends by dispatching whole-backlog Embed and Tags drains, so
 * "this item reaches the embed / tag lanes" means "it is an Embed pending
 * candidate now". This reads the very predicate the Embed drain claims by; an
 * untagged Embed candidate is a Tags candidate too.
 */

import { createCollectionProcessingPolicy } from '@/lib/collections/collection-processing-policy';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import type { FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';

/** platformItemIds the platform's sync-end Embed backlog drain would claim, sorted. */
export async function embedBacklogIds(
  db: FavbaseDb,
  platform: CollectionPlatform,
): Promise<string[]> {
  const policy = createCollectionProcessingPolicy(db, platform);
  const rows = await db
    .select({ id: items.platformItemId })
    .from(items)
    .where(policy.embedding.pendingCandidate);
  return rows.map((row) => row.id).sort();
}
