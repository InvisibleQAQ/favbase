import { eq, and } from 'drizzle-orm';
import { items } from '@/lib/database/entities/items';
import { itemContents } from '@/lib/database/entities/item-contents';
import type { FavbaseDb } from '@/lib/database/db';
import type { SubtitleRow, SubtitleSource } from '@/lib/transcription/types';

const PLATFORM = 'bilibili';

/**
 * Persist subtitle rows to PGlite: upsert item_contents + update content_state.
 * Fire-and-forget from UI — logs errors but never throws.
 */
export async function persistSubtitleContent(
  db: FavbaseDb,
  bvid: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<void> {
  try {
    // 1. Find the item by bvid
    const existing = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.platform, PLATFORM),
          eq(items.platformItemId, bvid),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      console.warn(`[content-sync] No item found for bvid=${bvid}, skipping persist`);
      return;
    }

    const itemId = existing[0].id;

    // 2. Convert rows to plain text
    const plainText = rows.map((r) => r.text).join('\n');

    // 3. Upsert item_contents
    await db
      .insert(itemContents)
      .values({ itemId, plainText })
      .onConflictDoUpdate({
        target: itemContents.itemId,
        set: { plainText, updatedAt: new Date() },
      });

    // 4. Update content_state to 'has_content'
    await db
      .update(items)
      .set({ contentState: 'has_content' })
      .where(eq(items.id, itemId));

    console.info(`[content-sync] Persisted ${rows.length} rows for bvid=${bvid} (source=${source})`);
  } catch (err) {
    console.error(`[content-sync] Failed to persist content for bvid=${bvid}:`, err);
  }
}
