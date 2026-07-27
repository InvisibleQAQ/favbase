import type { FavbaseDb } from '@/lib/database/db';
import { ingestCollection } from '@/lib/ingest/ingest';
import type { BiliFavVideo } from './types';

const PLATFORM = 'bilibili';

export interface SyncResult {
  total: number;
  synced: number;
  dropped: number;
  droppedBvids: string[];
  newItemIds: string[];
}

export async function syncFavVideosToDb(
  db: FavbaseDb,
  videos: BiliFavVideo[],
  platformSourceId: string,
): Promise<SyncResult> {
  const valid = videos.filter((v) => v.bvid);
  if (valid.length === 0) {
    return { total: 0, synced: 0, dropped: 0, droppedBvids: [], newItemIds: [] };
  }

  try {
    const result = await ingestCollection(db, {
      platform: PLATFORM,
      sources: [],
      authors: valid.map((video) => ({
        platformAuthorId: String(video.upper.mid),
        name: video.upper.name,
        avatarUrl: video.upper.face || null,
      })),
      items: valid.map((video) => ({
        platformItemId: video.bvid,
        platformAuthorId: String(video.upper.mid),
        title: video.title,
        authorName: video.upper.name,
        originalUrl: `https://www.bilibili.com/video/${video.bvid}`,
        publishedAt: null,
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
      })),
      links: valid.map((video) => ({
        platformItemId: video.bvid,
        platformSourceId,
      })),
    });

    const droppedBvids = [
      ...new Set([...result.droppedItemIds, ...result.droppedLinkItemIds]),
    ];
    if (droppedBvids.length > 0) {
      console.warn('[videos-sync] %d videos dropped:', droppedBvids.length, droppedBvids);
    }
    return {
      total: valid.length,
      synced: result.linkCount,
      dropped: droppedBvids.length,
      droppedBvids,
      newItemIds: result.inserted.map((item) => item.platformItemId),
    };
  } catch (err) {
    console.error('[videos-sync] Batch sync failed:', err);
    return {
      total: valid.length,
      synced: 0,
      dropped: valid.length,
      droppedBvids: valid.map((v) => v.bvid),
      newItemIds: [],
    };
  }
}
