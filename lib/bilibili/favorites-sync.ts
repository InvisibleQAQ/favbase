import { sql } from 'drizzle-orm';
import { sources } from '@/lib/database/entities/sources';
import type { Source } from '@/lib/database/entities/sources';
import type { FavbaseDb } from '@/lib/database/db';
import type { BiliFavFolder } from './types';

const PLATFORM = 'bilibili';

export async function syncFavFoldersToDb(
  db: FavbaseDb,
  folders: BiliFavFolder[],
): Promise<Source[]> {
  if (folders.length === 0) return [];

  const now = new Date();

  const values = folders.map((folder) => ({
    platform: PLATFORM,
    platformSourceId: String(folder.id),
    title: folder.title,
    platformMeta: {
      mlid: folder.id,
      fid: folder.fid,
      mid: folder.mid,
      media_count: folder.media_count,
      cover: folder.cover,
      intro: folder.intro,
      ctime: folder.ctime,
      mtime: folder.mtime,
      attr: folder.attr,
    },
    lastFetchedAt: now,
  }));

  return db
    .insert(sources)
    .values(values)
    .onConflictDoUpdate({
      target: [sources.platform, sources.platformSourceId],
      set: {
        title: sql`excluded.title`,
        platformMeta: sql`excluded.platform_meta`,
        lastFetchedAt: sql`excluded.last_fetched_at`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();
}
