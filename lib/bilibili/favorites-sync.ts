import { and, eq, inArray } from 'drizzle-orm';
import { sources } from '@/lib/database/entities/sources';
import type { Source } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import type { FavbaseDb } from '@/lib/database/db';
import { ingestCollection } from '@/lib/ingest/ingest';
import type { FavoriteVideosSyncBaseline } from './favorites-sync-runner';
import type { BiliFavFolder } from './types';

const PLATFORM = 'bilibili';
export const VIDEO_HISTORY_COMPLETE_META_KEY = 'videos_sync_complete';

export function isVideoHistoryComplete(platformMeta: unknown): boolean {
  if (!platformMeta || typeof platformMeta !== 'object') return false;
  return (platformMeta as Record<string, unknown>)[VIDEO_HISTORY_COMPLETE_META_KEY] === true;
}

interface VideoSyncSource {
  id: string;
  platformMeta: unknown;
}

async function requireVideoSyncSource(
  db: FavbaseDb,
  platformSourceId: string,
): Promise<VideoSyncSource> {
  const [source] = await db
    .select({ id: sources.id, platformMeta: sources.platformMeta })
    .from(sources)
    .where(
      and(
        eq(sources.platform, PLATFORM),
        eq(sources.platformSourceId, platformSourceId),
      ),
    )
    .limit(1);

  if (!source) throw new Error(`Bilibili source ${platformSourceId} not found`);
  return source;
}

export async function getFavoriteVideoSyncBaseline(
  db: FavbaseDb,
  platformSourceId: string,
): Promise<FavoriteVideosSyncBaseline> {
  const source = await requireVideoSyncSource(db, platformSourceId);
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .innerJoin(itemSources, eq(items.id, itemSources.itemId))
    .where(
      and(
        eq(items.platform, PLATFORM),
        eq(itemSources.sourceId, source.id),
      ),
    );

  return {
    existingBvids: new Set(rows.map((row) => row.platformItemId)),
    historyComplete: isVideoHistoryComplete(source.platformMeta),
  };
}

export async function markVideoHistoryComplete(
  db: FavbaseDb,
  platformSourceId: string,
): Promise<void> {
  const source = await requireVideoSyncSource(db, platformSourceId);
  if (isVideoHistoryComplete(source.platformMeta)) return;

  await db
    .update(sources)
    .set({
      platformMeta: {
        ...(source.platformMeta as Record<string, unknown>),
        [VIDEO_HISTORY_COMPLETE_META_KEY]: true,
      },
    })
    .where(eq(sources.id, source.id));
}

export async function syncFavFoldersToDb(
  db: FavbaseDb,
  folders: BiliFavFolder[],
): Promise<Source[]> {
  if (folders.length === 0) return [];

  const platformSourceIds = folders.map((folder) => String(folder.id));
  const previous = await db
    .select({
      platformSourceId: sources.platformSourceId,
      platformMeta: sources.platformMeta,
    })
    .from(sources)
    .where(
      and(
        eq(sources.platform, PLATFORM),
        inArray(sources.platformSourceId, platformSourceIds),
      ),
    );
  const completedSourceIds = new Set(
    previous
      .filter((source) => isVideoHistoryComplete(source.platformMeta))
      .map((source) => source.platformSourceId),
  );

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
        ...(completedSourceIds.has(String(folder.id))
          ? { [VIDEO_HISTORY_COMPLETE_META_KEY]: true }
          : {}),
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
