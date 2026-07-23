import { and, eq, inArray } from 'drizzle-orm';
import { sources } from '@/lib/database/entities/sources';
import type { Source } from '@/lib/database/entities/sources';
import type { FavbaseDb } from '@/lib/database/db';
import { ingestCollection } from '@/lib/ingest/ingest';
import type { BiliFavFolder } from './types';

const PLATFORM = 'bilibili';

export async function syncFavFoldersToDb(
  db: FavbaseDb,
  folders: BiliFavFolder[],
): Promise<Source[]> {
  if (folders.length === 0) return [];

  const platformSourceIds = folders.map((folder) => String(folder.id));
  await ingestCollection(db, {
    platform: PLATFORM,
    sources: folders.map((folder) => ({
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
    })),
    authors: [],
    items: [],
    links: [],
  });

  const persisted = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.platform, PLATFORM),
        inArray(sources.platformSourceId, platformSourceIds),
      ),
    );
  const byPlatformId = new Map(persisted.map((source) => [source.platformSourceId, source]));
  return platformSourceIds.flatMap((platformSourceId) => {
    const source = byPlatformId.get(platformSourceId);
    return source ? [source] : [];
  });
}
