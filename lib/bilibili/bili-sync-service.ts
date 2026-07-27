import { eq, and, inArray } from 'drizzle-orm';
import { getBiliAuth, fetchFavFolders, fetchFavVideos, BiliAuthError } from './bilibili-api';
import {
  getFavoriteVideoSyncBaseline,
  markVideoHistoryComplete,
  syncFavFoldersToDb,
} from './favorites-sync';
import {
  favoritePageDelayMs,
  runFavoriteVideosSync,
  type BiliFavoritesSyncProgressCallback,
  type BiliFavoritesItemsPersistedCallback,
  type FavoriteVideosSyncResult,
} from './favorites-sync-runner';
import { syncFavVideosToDb, type SyncResult } from './videos-sync';
import { chunkSubtitleRows, embedPlatformItem } from '@/lib/embedding';
import { persistExistingItemContent } from '@/lib/ingest/ingest';
import { getDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import type { BiliFavFolder, BiliFavOrder, BiliFavVideo } from './types';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type { CooperativeCheckpoint } from '@/lib/collections';

export { BiliAuthError };
export type { BiliFavoritesSyncProgress } from './favorites-sync-runner';

const PLATFORM = 'bilibili';
const PAGE_SIZE = 20;

function assertVideosPersisted(result: SyncResult, sourceId: string | number): void {
  if (result.dropped > 0) {
    throw new Error(
      `Failed to persist ${result.dropped} Bilibili favorites for source ${sourceId}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncVideosResult {
  videos: BiliFavVideo[];
  folderTitle: string;
  totalPages: number;
  mediaCount: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkAuth() {
  const auth = await getBiliAuth();
  if (!auth) throw new BiliAuthError('Not logged in');
  return auth;
}

export async function fetchAndSyncFolders(
  control?: CooperativeCheckpoint,
): Promise<BiliFavFolder[]> {
  await control?.checkpoint();
  const auth = await checkAuth();
  const folders = await fetchFavFolders(auth);

  if (folders.length > 0) {
    const db = getDb();
    await syncFavFoldersToDb(db, folders);
  }

  return folders;
}

export async function fetchFavoriteVideosPage(
  mediaId: number,
  page: number,
  order: BiliFavOrder = 'mtime',
  keyword: string = '',
): Promise<SyncVideosResult> {
  const auth = await checkAuth();
  const data = await fetchFavVideos(auth, mediaId, page, PAGE_SIZE, order, keyword);
  const videos = data.medias ?? [];

  return {
    videos,
    folderTitle: data.info.title,
    totalPages: Math.max(1, Math.ceil(data.info.media_count / PAGE_SIZE)),
    mediaCount: data.info.media_count,
  };
}

export async function syncAllFavoriteVideos(
  folders: BiliFavFolder[],
  onProgress?: BiliFavoritesSyncProgressCallback,
  control?: CooperativeCheckpoint,
  onItemsPersisted?: BiliFavoritesItemsPersistedCallback,
): Promise<FavoriteVideosSyncResult> {
  const auth = await checkAuth();
  const db = getDb();

  return runFavoriteVideosSync(
    folders,
    {
      async getBaseline(folder) {
        return getFavoriteVideoSyncBaseline(db, String(folder.id));
      },
      async fetchPage(folder, page) {
        const data = await fetchFavVideos(auth, folder.id, page, PAGE_SIZE, 'mtime', '');
        return {
          videos: data.medias ?? [],
          totalPages: Math.max(1, Math.ceil(data.info.media_count / PAGE_SIZE)),
          hasMore: data.has_more,
        };
      },
      async persist(folder, videos) {
        const result = await syncFavVideosToDb(db, videos, String(folder.id));
        assertVideosPersisted(result, folder.id);
        return result.newItemIds;
      },
      markHistoryComplete(folder) {
        return markVideoHistoryComplete(db, String(folder.id));
      },
      waitBetweenPages() {
        return new Promise((resolve) => setTimeout(resolve, favoritePageDelayMs()));
      },
    },
    onProgress,
    control,
    onItemsPersisted,
  );
}

export async function markVideoError(bvid: string): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(items)
      .set({ contentState: 'error' })
      .where(and(eq(items.platform, PLATFORM), eq(items.platformItemId, bvid)));
  } catch { /* fire-and-forget */ }
}

export type PersistContentResult = 'embedded' | 'chunked' | null;

/**
 * Persist transcription content and timestamped chunks, stopping at the
 * durable seam shared by independent post-processors.
 */
export async function persistContentChunks(
  bvid: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<'chunked' | null> {
  try {
    const db = getDb();
    const result = await persistExistingItemContent(
      db,
      PLATFORM,
      bvid,
      rows.map((row) => row.text).join('\n'),
      chunkSubtitleRows(rows),
    );
    if (result) {
      console.info(
        `[bili-sync] Persisted ${rows.length} rows for bvid=${bvid} (source=${source})`,
      );
    }
    return result;
  } catch (err) {
    console.error(`[bili-sync] Content persistence failed for bvid=${bvid}:`, err);
    return null;
  }
}

/**
 * Backward-compatible combined operation. New orchestration should use
 * `persistContentChunks` and start its post-processors from that data seam.
 */
export async function persistContent(
  bvid: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<PersistContentResult> {
  const persisted = await persistContentChunks(bvid, rows, source);
  if (!persisted) return null;
  return embedPlatformItem(PLATFORM, bvid);
}

/** Subset of the given bvids whose content_state is 'embedded' (indexed chip). */
export async function getEmbeddedBvids(pageBvids: string[]): Promise<string[]> {
  if (pageBvids.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(
      and(
        eq(items.platform, PLATFORM),
        inArray(items.platformItemId, pageBvids),
        eq(items.contentState, 'embedded'),
      ),
    );
  return rows.map((r) => r.platformItemId);
}
