import { eq, and } from 'drizzle-orm';
import { sources } from '@/lib/database/entities/sources';
import type { Source } from '@/lib/database/entities/sources';
import type { FavbaseDb } from '@/lib/database/db';
import type { BiliFavFolder } from './favorites';

const PLATFORM = 'bilibili';

export async function syncFavFoldersToDb(
  db: FavbaseDb,
  folders: BiliFavFolder[],
): Promise<Source[]> {
  const results: Source[] = [];

  for (const folder of folders) {
    const platformSourceId = String(folder.fid);

    const existing = await db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.platform, PLATFORM),
          eq(sources.platformSourceId, platformSourceId),
        ),
      )
      .limit(1);

    const meta = {
      mlid: folder.id,
      fid: folder.fid,
      mid: folder.mid,
      media_count: folder.media_count,
      cover: folder.cover,
      intro: folder.intro,
      ctime: folder.ctime,
      mtime: folder.mtime,
      attr: folder.attr,
    };

    if (existing.length > 0) {
      const [updated] = await db
        .update(sources)
        .set({
          title: folder.title,
          platformMeta: meta,
          lastFetchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sources.id, existing[0].id))
        .returning();
      results.push(updated);
    } else {
      const [inserted] = await db
        .insert(sources)
        .values({
          platform: PLATFORM,
          platformSourceId,
          title: folder.title,
          platformMeta: meta,
          lastFetchedAt: new Date(),
        })
        .returning();
      results.push(inserted);
    }
  }

  return results;
}
