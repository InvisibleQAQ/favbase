import { eq, and } from 'drizzle-orm';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import type { FavbaseDb } from '@/lib/database/db';
import type { BiliFavVideo } from './types';

const PLATFORM = 'bilibili';

/**
 * Persist BiliFavVideo[] to PGlite: upsert authors + items + item_sources.
 * MVP: insert-only — existing records are not updated.
 * Per-video try/catch so partial failures don't abort the batch.
 */
export async function syncFavVideosToDb(
  db: FavbaseDb,
  videos: BiliFavVideo[],
  sourceId: string,
): Promise<void> {
  for (const video of videos) {
    if (!video.bvid) continue;

    try {
      // 1. Upsert author
      const platformAuthorId = String(video.upper.mid);
      const existingAuthor = await db
        .select()
        .from(authors)
        .where(
          and(
            eq(authors.platform, PLATFORM),
            eq(authors.platformAuthorId, platformAuthorId),
          ),
        )
        .limit(1);

      let authorId: string;
      if (existingAuthor.length > 0) {
        authorId = existingAuthor[0].id;
      } else {
        const [inserted] = await db
          .insert(authors)
          .values({
            platform: PLATFORM,
            platformAuthorId,
            name: video.upper.name,
            avatarUrl: video.upper.face || null,
          })
          .returning();
        authorId = inserted.id;
      }

      // 2. Upsert item
      const existingItem = await db
        .select()
        .from(items)
        .where(
          and(
            eq(items.platform, PLATFORM),
            eq(items.platformItemId, video.bvid),
          ),
        )
        .limit(1);

      let itemId: string;
      if (existingItem.length > 0) {
        itemId = existingItem[0].id;
      } else {
        const [inserted] = await db
          .insert(items)
          .values({
            platform: PLATFORM,
            platformItemId: video.bvid,
            authorId,
            title: video.title,
            authorName: video.upper.name,
            originalUrl: `https://www.bilibili.com/video/${video.bvid}`,
            contentState: 'pending',
            platformMeta: {
              cover: video.cover,
              intro: video.intro,
              duration: video.duration,
              cnt_info: video.cnt_info,
              attr: video.attr,
              type: video.type,
              fav_time: video.fav_time,
            },
          })
          .returning();
        itemId = inserted.id;
      }

      // 3. Upsert item_sources link
      const existingLink = await db
        .select()
        .from(itemSources)
        .where(
          and(
            eq(itemSources.itemId, itemId),
            eq(itemSources.sourceId, sourceId),
          ),
        )
        .limit(1);

      if (existingLink.length === 0) {
        await db.insert(itemSources).values({ itemId, sourceId });
      }
    } catch (err) {
      console.error(
        `[videos-sync] Failed to sync video bvid=${video.bvid}:`,
        err,
      );
    }
  }
}
