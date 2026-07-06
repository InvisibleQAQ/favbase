import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { getBiliAuth, fetchFavFolders, fetchFavVideos, BiliAuthError } from './bilibili-api';
import { syncFavFoldersToDb } from './favorites-sync';
import { syncFavVideosToDb } from './videos-sync';
import { persistSubtitleContent } from './content-sync';
import { getDb } from '@/lib/database';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { normalizeCover } from './url-utils';
import type { BiliFavFolder, BiliFavOrder, BiliFavVideo } from './types';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';

export { BiliAuthError };

const PLATFORM = 'bilibili';
const PAGE_SIZE = 20;

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

async function resolveSourceId(mediaId: number): Promise<string | null> {
  const source = await resolveSource(mediaId);
  return source?.id ?? null;
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
    syncFavFoldersToDb(db, folders).catch((err) => {
      console.error('[bili-sync] Folder DB sync failed:', err);
      if (err?.cause) console.error('[bili-sync] Cause:', err.cause);
    });
  }

  return folders;
}

export async function fetchAndSyncVideos(
  mediaId: number,
  page: number,
  order: BiliFavOrder = 'mtime',
): Promise<SyncVideosResult> {
  const auth = await checkAuth();
  const data = await fetchFavVideos(auth, mediaId, page, PAGE_SIZE, order);
  const videos = data.medias ?? [];

  if (videos.length > 0) {
    syncVideosBackground(videos, mediaId).catch((err) => {
      console.error('[bili-sync] Video DB sync failed:', err);
      if (err?.cause) console.error('[bili-sync] Cause:', err.cause);
    });
  }

  return {
    videos,
    folderTitle: data.info.title,
    totalPages: Math.max(1, Math.ceil(data.info.media_count / PAGE_SIZE)),
    mediaCount: data.info.media_count,
  };
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

export async function persistContent(
  bvid: string,
  rows: SubtitleRow[],
  source: SubtitleSource,
): Promise<void> {
  try {
    const db = getDb();
    await persistSubtitleContent(db, bvid, rows, source);
  } catch { /* fire-and-forget */ }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function syncVideosBackground(videos: BiliFavVideo[], mediaId: number): Promise<void> {
  const sourceId = await resolveSourceId(mediaId);
  if (!sourceId) return;
  const db = getDb();
  await syncFavVideosToDb(db, videos, sourceId);
}
