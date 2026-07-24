import { eq, and, inArray, sql, desc } from 'drizzle-orm';
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
  type FavoriteVideosSyncResult,
} from './favorites-sync-runner';
import { syncFavVideosToDb, type SyncResult } from './videos-sync';
import { chunkSubtitleRows, embedPlatformItem } from '@/lib/embedding';
import { persistExistingItemContent } from '@/lib/ingest/ingest';
import { getDb } from '@/lib/database';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { normalizeCover } from './url-utils';
import type { BiliFavFolder, BiliFavOrder, BiliFavVideo } from './types';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';

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

export interface PendingPreview {
  video: { cover: string; title: string; upper: string; duration: number } | null;
  pendingCount: number | null;
}

// ---------------------------------------------------------------------------
// Internal: source lookup (the knowledge that was leaking everywhere)
// ---------------------------------------------------------------------------

interface ResolvedSource {
  id: string;
  platformMeta: Record<string, unknown>;
}

async function resolveSource(mediaId: number): Promise<ResolvedSource | null> {
  const db = getDb();
  const rows = await db
    .select({ id: sources.id, platformMeta: sources.platformMeta })
    .from(sources)
    .where(and(eq(sources.platform, PLATFORM), eq(sources.platformSourceId, String(mediaId))))
    .limit(1);

  if (rows.length === 0) {
    console.warn('[bili-sync] Source not found for mediaId=%d, skipping', mediaId);
    return null;
  }
  return { id: rows[0].id, platformMeta: rows[0].platformMeta as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkAuth() {
  const auth = await getBiliAuth();
  if (!auth) throw new BiliAuthError('Not logged in');
  return auth;
}

export async function fetchAndSyncFolders(): Promise<BiliFavFolder[]> {
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

export async function fetchAndSyncVideos(
  mediaId: number,
  page: number,
  order: BiliFavOrder = 'mtime',
  keyword: string = '',
): Promise<SyncVideosResult> {
  const result = await fetchFavoriteVideosPage(mediaId, page, order, keyword);

  if (result.videos.length > 0) {
    await persistFetchedVideos(result.videos, mediaId);
  }

  return result;
}

export async function syncAllFavoriteVideos(
  folders: BiliFavFolder[],
  onProgress?: BiliFavoritesSyncProgressCallback,
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
      },
      markHistoryComplete(folder) {
        return markVideoHistoryComplete(db, String(folder.id));
      },
      waitBetweenPages() {
        return new Promise((resolve) => setTimeout(resolve, favoritePageDelayMs()));
      },
    },
    onProgress,
  );
}

export async function getPendingBvids(
  pageBvids: string[],
): Promise<string[]> {
  if (pageBvids.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(
      and(
        eq(items.platform, PLATFORM),
        inArray(items.platformItemId, pageBvids),
        eq(items.contentState, 'pending'),
      ),
    );
  return rows.map((r) => r.platformItemId);
}

export async function getPendingPreview(mediaId: number): Promise<PendingPreview> {
  const source = await resolveSource(mediaId);
  if (!source) return { video: null, pendingCount: null };

  const db = getDb();
  const sourceFilter = and(
    eq(itemSources.sourceId, source.id),
    eq(items.platform, PLATFORM),
  );
  const pendingFilter = and(sourceFilter, eq(items.contentState, 'pending'));

  const [pendingRows, countRows] = await Promise.all([
    db
      .select({ title: items.title, authorName: items.authorName, platformMeta: items.platformMeta })
      .from(items)
      .innerJoin(itemSources, eq(items.id, itemSources.itemId))
      .where(pendingFilter)
      .orderBy(desc(items.createdAt))
      .limit(1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        nonPending: sql<number>`sum(case when ${items.contentState} != 'pending' then 1 else 0 end)::int`,
      })
      .from(items)
      .innerJoin(itemSources, eq(items.id, itemSources.itemId))
      .where(sourceFilter),
  ]);

  const totalSynced = countRows[0]?.total ?? 0;
  if (totalSynced === 0) return { video: null, pendingCount: null };

  const nonPending = countRows[0]?.nonPending ?? 0;
  const apiTotal = typeof source.platformMeta?.media_count === 'number'
    ? source.platformMeta.media_count
    : null;

  // Use API total when available: pending = apiTotal - already transcribed.
  // Fallback to DB-only count when media_count is missing (stale data).
  const pendingCount = apiTotal !== null
    ? Math.max(0, apiTotal - nonPending)
    : totalSynced - nonPending;

  if (pendingRows.length === 0) return { video: null, pendingCount };

  const row = pendingRows[0];
  const meta = row.platformMeta as Record<string, unknown> | null;

  return {
    video: {
      cover: normalizeCover(meta?.cover as string),
      title: row.title,
      upper: row.authorName,
      duration: typeof meta?.duration === 'number' ? meta.duration : 0,
    },
    pendingCount,
  };
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

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function persistFetchedVideos(videos: BiliFavVideo[], mediaId: number): Promise<void> {
  if (!(await resolveSource(mediaId))) {
    throw new Error(`Cannot persist Bilibili favorites: source ${mediaId} not found`);
  }
  const db = getDb();
  const result = await syncFavVideosToDb(db, videos, String(mediaId));
  assertVideosPersisted(result, mediaId);
}
