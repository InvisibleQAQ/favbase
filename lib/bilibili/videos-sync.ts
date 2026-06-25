import { and, eq, inArray } from 'drizzle-orm';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import type { FavbaseDb } from '@/lib/database/db';
import type { BiliFavVideo } from './types';

const PLATFORM = 'bilibili';

export async function syncFavVideosToDb(
  db: FavbaseDb,
  videos: BiliFavVideo[],
  sourceId: string,
): Promise<void> {
  const valid = videos.filter((v) => v.bvid);
  if (valid.length === 0) return;

  try {
    await db.transaction(async (tx) => {
      // 1. Deduplicate authors by platformAuthorId, keep first occurrence
      const authorMap = new Map<string, BiliFavVideo['upper']>();
      for (const v of valid) {
        const key = String(v.upper.mid);
        if (!authorMap.has(key)) authorMap.set(key, v.upper);
      }

      const authorValues = [...authorMap.entries()].map(([pid, upper]) => ({
        platform: PLATFORM,
        platformAuthorId: pid,
        name: upper.name,
        avatarUrl: upper.face || null,
      }));

      await tx
        .insert(authors)
        .values(authorValues)
        .onConflictDoNothing({ target: [authors.platform, authors.platformAuthorId] });

      // 2. Batch select authors to build platformAuthorId -> id map
      const authorRows = await tx
        .select({ id: authors.id, platformAuthorId: authors.platformAuthorId })
        .from(authors)
        .where(
          and(
            eq(authors.platform, PLATFORM),
            inArray(authors.platformAuthorId, [...authorMap.keys()]),
          ),
        );

      const authorIdMap = new Map(authorRows.map((r) => [r.platformAuthorId, r.id]));

      // 3. Batch insert items
      const itemValues = valid
        .map((v) => {
          const authorId = authorIdMap.get(String(v.upper.mid));
          if (!authorId) return null;
          return {
            platform: PLATFORM,
            platformItemId: v.bvid,
            authorId,
            title: v.title,
            authorName: v.upper.name,
            originalUrl: `https://www.bilibili.com/video/${v.bvid}`,
            contentState: 'pending' as const,
            platformMeta: {
              cover: v.cover,
              intro: v.intro,
              duration: v.duration,
              cnt_info: v.cnt_info,
              attr: v.attr,
              type: v.type,
              fav_time: v.fav_time,
            },
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      await tx
        .insert(items)
        .values(itemValues)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });

      // 4. Batch select items to build bvid -> id map
      const bvids = valid.map((v) => v.bvid);
      const itemRows = await tx
        .select({ id: items.id, platformItemId: items.platformItemId })
        .from(items)
        .where(
          and(
            eq(items.platform, PLATFORM),
            inArray(items.platformItemId, bvids),
          ),
        );

      const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

      // 5. Batch insert item_sources links
      const linkValues = valid
        .map((v) => {
          const itemId = itemIdMap.get(v.bvid);
          return itemId ? { itemId, sourceId } : null;
        })
        .filter((v): v is { itemId: string; sourceId: string } => v !== null);

      if (linkValues.length > 0) {
        await tx
          .insert(itemSources)
          .values(linkValues)
          .onConflictDoNothing();
      }
    });
  } catch (err) {
    console.error('[videos-sync] Batch sync failed:', err);
  }
}
