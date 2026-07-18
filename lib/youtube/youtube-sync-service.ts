/**
 * YouTube public-playlists domain sync service — the ONLY holder of DB schema
 * knowledge for the `youtube` platform (mirrors lib/zhihu/zhihu-sync-service.ts
 * layering: multi-source platform). Consumers (hooks / UI) call the high-level
 * operations here and never import drizzle / entities / getDb.
 *
 * Model: one `sources` row PER public playlist (`platformSourceId=playlistId`,
 * title refreshed on sync — the ADR-allowed upsert exception), uploader
 * channels → `authors` rows, videos → `items` rows (a video in N playlists is
 * ONE item + N `item_sources` links — the zhihu multi-collection shape),
 * non-empty descriptions → `item_contents` + `item_chunks` with
 * `content_state='chunked'` (empty → 'no_content').
 *
 * Sync is a FULL refetch every run: playlist order is position order
 * (user-reorderable), so the old LL stop-on-known-id incremental cutoff is
 * unsafe here. Insert-only dedupe makes the refetch idempotent; the
 * `needsDetails` predicate keeps videos.list calls to genuinely-new ids.
 *
 * Insert-only ADR (.trellis/spec/frontend/database-bridge.md) applies:
 * items / authors / item_sources are insert-only (`onConflictDoNothing`,
 * first-write-wins). Removing a video from a playlist never deletes rows.
 *
 * Embedding is NOT run inline during sync (D3). Descriptions are persisted +
 * chunked → `content_state='chunked'`; vectorization is deferred to the
 * settings 「重建向量」batch. ILIKE search works right after sync.
 */

import { desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { escapeLike } from '@/lib/database/sql-utils';
import {
  getPlatformLastSyncedAt,
  pagedItemsQuery,
  type PagedItemRow,
} from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { ingestCollection } from '@/lib/ingest/ingest';
import {
  resolveChannel,
  fetchPlaylists,
  fetchPlaylistItems,
  type YoutubePlaylist,
  type PlaylistEntry,
  type YoutubePlaylistVideo,
} from './youtube-api';
import { chunkDescription } from './youtube-chunker';

// Re-export what service consumers actually need: structured errors + the
// types appearing in public signatures below. The channel probe
// (resolveChannel) is a settings-card concern — import it from './youtube-api'.
export { YoutubeAuthError, YoutubeRateLimitError } from './youtube-api';
export type { YoutubePlaylist, YoutubePlaylistVideo } from './youtube-api';

const PLATFORM = 'youtube';
/** platformMeta keeps a card-sized description slice; full text → item_contents. */
const META_DESCRIPTION_MAX_CHARS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface YoutubeItemMeta {
  /** Truncated to META_DESCRIPTION_MAX_CHARS — full text lives in item_contents. */
  description: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  /** ISO — playlistItems.snippet.publishedAt of the FIRST-SEEN playlist
   *  membership (official semantics: "date added to playlist"). Sort key. */
  addedAt: string;
  /** ISO — the video's own publish time. */
  videoPublishedAt: string;
  /** First-seen playlist membership (display); filtering uses item_sources. */
  playlistId: string;
  playlistTitle: string;
}

/** API key + raw channel input, read from UserSettings by the CALLER (UI hook). */
export interface YoutubeSyncConfig {
  apiKey: string;
  /** Raw input: @handle / UC… id / channel URL — resolved via channels.list. */
  channel: string;
}

/** Progress for the playlists sync — playlist cursor + cumulative entries. */
export interface YoutubePlaylistsProgress {
  /** 1-based index of the playlist currently being fetched. */
  playlistIndex: number;
  playlistCount: number;
  /** Cumulative playlist entries fetched across all playlists so far. */
  fetchedCount: number;
}

export type PlaylistsProgressCallback = (progress: YoutubePlaylistsProgress) => void;

/** One playlist's fetch output — the DB-write input unit (exported for tests). */
export interface PlaylistBatch {
  playlist: YoutubePlaylist;
  entries: PlaylistEntry[];
  videos: YoutubePlaylistVideo[];
}

export interface SyncPlaylistsResult {
  /** Public playlists seen this run. */
  playlists: number;
  /** Total membership entries processed (links material). */
  entries: number;
  /** Items newly inserted this run (content persisted for these only). */
  inserted: number;
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface YoutubeVideoItem {
  /** items.id (uuid) */
  id: string;
  /** YouTube video id (items.platformItemId) */
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  /** Card-sized description slice (platformMeta, truncated). */
  description: string;
  originalUrl: string;
  /** ISO added-to-playlist string (sort key), null when absent. */
  addedAt: string | null;
  /** ISO video publish time, null when absent. */
  videoPublishedAt: string | null;
  publishedAt: Date | null;
}

export interface PlaylistVideosQuery {
  /** Restrict to one playlist (sources.platformSourceId). Omit = whole library. */
  playlistId?: string;
  /** ILIKE match on title / description. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

/** Playlist chip data — one per playlist that has items. */
export interface PlaylistCount {
  playlistId: string;
  title: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/**
 * One-shot full sync: resolve channel → list public playlists → fetch each
 * playlist's items (details only for ids unseen in DB + this run) → persist
 * insert-only. Config must be resolved by the CALLER (UI hook reads
 * UserSettings). Auth / rate-limit errors propagate to the caller (UI shows
 * error state) — nothing is written on fetch failure.
 */
export async function syncYoutubePlaylists(
  config: YoutubeSyncConfig,
  onProgress?: PlaylistsProgressCallback,
): Promise<SyncPlaylistsResult> {
  const db = getDb();

  const channel = await resolveChannel(config.apiKey, config.channel);
  const playlists = await fetchPlaylists(config.apiKey, channel.channelId);

  const known = await getKnownVideoIds(db);
  const fetchedThisRun = new Set<string>();
  const batches: PlaylistBatch[] = [];
  let entryTotal = 0;

  for (const [index, playlist] of playlists.entries()) {
    const playlistIndex = index + 1;
    onProgress?.({ playlistIndex, playlistCount: playlists.length, fetchedCount: entryTotal });

    const result = await fetchPlaylistItems(config.apiKey, playlist.playlistId, {
      needsDetails: (id) => !known.has(id) && !fetchedThisRun.has(id),
      onPage: (_page, entryCount) =>
        onProgress?.({
          playlistIndex,
          playlistCount: playlists.length,
          fetchedCount: entryTotal + entryCount,
        }),
    });

    for (const v of result.videos) fetchedThisRun.add(v.videoId);
    entryTotal += result.entries.length;
    batches.push({ playlist, entries: result.entries, videos: result.videos });
  }

  return syncPlaylistsToDb(db, batches);
}

/** Set of already-stored video ids (platform='youtube') — details-fill skip set. */
async function getKnownVideoIds(db: FavbaseDb): Promise<Set<string>> {
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(eq(items.platform, PLATFORM));
  return new Set(rows.map((r) => r.platformItemId));
}

/**
 * Persist playlist batches. Exported for tests — production goes through
 * `syncYoutubePlaylists`. The transaction skeleton (per-playlist sources
 * upsert → authors → items → links → two-phase content write) is delegated to
 * the shared `ingestCollection` pipeline; this function only declares the
 * normalized rows.
 */
export async function syncPlaylistsToDb(
  db: FavbaseDb,
  batches: PlaylistBatch[],
): Promise<SyncPlaylistsResult> {
  const entryCount = batches.reduce((n, b) => n + b.entries.length, 0);
  if (batches.length === 0) return { playlists: 0, entries: 0, inserted: 0 };

  // Dedupe across playlists in batch order: the first-seen playlist supplies
  // addedAt + the display membership (playlistId/playlistTitle in platformMeta).
  const byId = new Map<string, { video: YoutubePlaylistVideo; playlist: YoutubePlaylist }>();
  for (const { playlist, videos } of batches) {
    for (const v of videos) {
      if (!byId.has(v.videoId)) byId.set(v.videoId, { video: v, playlist });
    }
  }

  const result = await ingestCollection(db, {
    platform: PLATFORM,
    // One source per playlist — empty playlists still get a row so the UI can
    // distinguish "never synced" from "synced, empty".
    sources: batches.map(({ playlist }) => ({
      platformSourceId: playlist.playlistId,
      title: playlist.title || playlist.playlistId,
    })),
    // Uploader channels (Data API v3 video responses carry no channel avatar
    // — avatarUrl stays null).
    authors: [...byId.values()]
      .filter(({ video }) => video.channelId)
      .map(({ video }) => ({
        platformAuthorId: video.channelId,
        name: video.channelTitle || video.channelId,
        avatarUrl: null,
      })),
    items: [...byId.values()].map(({ video: v, playlist }) => ({
      platformItemId: v.videoId,
      platformAuthorId: v.channelId,
      title: v.title || v.videoId,
      authorName: v.channelTitle || v.channelId,
      originalUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
      publishedAt: v.videoPublishedAt ? new Date(v.videoPublishedAt) : null,
      contentState: v.description.trim() ? ('chunked' as const) : ('no_content' as const),
      platformMeta: {
        description: v.description.slice(0, META_DESCRIPTION_MAX_CHARS),
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        thumbnailUrl: v.thumbnailUrl,
        durationSeconds: v.durationSeconds,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        addedAt: v.addedAt,
        videoPublishedAt: v.videoPublishedAt,
        playlistId: playlist.playlistId,
        playlistTitle: playlist.title,
      } satisfies YoutubeItemMeta,
    })),
    // Links from ALL membership entries (not just detail-filled videos): a
    // known video newly added to another playlist still gets its link.
    // Entries whose video never got an item row (deleted/private, never
    // stored) resolve to no itemId and drop out naturally.
    links: batches.flatMap(({ playlist, entries }) =>
      entries.map((entry) => ({
        platformItemId: entry.videoId,
        platformSourceId: playlist.playlistId,
      })),
    ),
    content: {
      textOf: (videoId) => byId.get(videoId)?.video.description ?? '',
      chunk: chunkDescription,
    },
  });

  return {
    playlists: batches.length,
    entries: entryCount,
    inserted: result.inserted.length,
  };
}

// ---------------------------------------------------------------------------
// Public API — queries (YouTube collections page reads from PGlite, not the API)
// ---------------------------------------------------------------------------

/**
 * Paged playlist videos, addedAt descending (ISO strings — lexicographic order
 * IS chronological order, github starredAt pattern). Optional playlist chip
 * filter (item_sources membership, zhihu pattern) + ILIKE search over
 * title / description.
 */
export async function getPlaylistVideos(
  query: PlaylistVideosQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: YoutubeVideoItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];

  if (query.playlistId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${itemSources}
        JOIN ${sources} ON ${sources.id} = ${itemSources.sourceId}
        WHERE ${itemSources.itemId} = ${items.id}
          AND ${sources.platform} = ${PLATFORM}
          AND ${sources.platformSourceId} = ${query.playlistId}
      )`,
    );
  }
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      or(
        ilike(items.title, pattern),
        sql`${items.platformMeta}->>'description' ILIKE ${pattern}`,
      ),
    );
  }

  return pagedItemsQuery(db, {
    conditions,
    orderBy: desc(sql`${items.platformMeta}->>'addedAt'`),
    page: query.page,
    pageSize: query.pageSize,
    mapRow: toVideoItem,
  });
}

/** Distinct playlists with video counts, descending — data for the chip row. */
export async function getPlaylistCounts(db: FavbaseDb = getDb()): Promise<PlaylistCount[]> {
  const rows = await db
    .select({
      playlistId: sources.platformSourceId,
      title: sources.title,
      count: sql<number>`count(*)::int`,
    })
    .from(itemSources)
    .innerJoin(sources, eq(itemSources.sourceId, sources.id))
    .innerJoin(items, eq(itemSources.itemId, items.id))
    .where(eq(sources.platform, PLATFORM))
    .groupBy(sources.platformSourceId, sources.title)
    .orderBy(desc(sql`count(*)`), sources.title);
  return rows;
}

/** When playlists were last synced; null = never synced. */
export async function getLastSyncedAt(db: FavbaseDb = getDb()): Promise<Date | null> {
  return getPlatformLastSyncedAt(PLATFORM, db);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function toVideoItem(row: PagedItemRow): YoutubeVideoItem {
  const meta = (row.platformMeta ?? {}) as Partial<YoutubeItemMeta>;
  return {
    id: row.id,
    videoId: row.platformItemId,
    title: row.title,
    channelId: typeof meta.channelId === 'string' ? meta.channelId : '',
    channelTitle:
      typeof meta.channelTitle === 'string' && meta.channelTitle
        ? meta.channelTitle
        : row.authorName,
    thumbnailUrl:
      typeof meta.thumbnailUrl === 'string' && meta.thumbnailUrl ? meta.thumbnailUrl : null,
    durationSeconds: typeof meta.durationSeconds === 'number' ? meta.durationSeconds : 0,
    viewCount: typeof meta.viewCount === 'number' ? meta.viewCount : 0,
    likeCount: typeof meta.likeCount === 'number' ? meta.likeCount : 0,
    description: typeof meta.description === 'string' ? meta.description : '',
    originalUrl: row.originalUrl,
    addedAt: typeof meta.addedAt === 'string' && meta.addedAt ? meta.addedAt : null,
    videoPublishedAt:
      typeof meta.videoPublishedAt === 'string' && meta.videoPublishedAt
        ? meta.videoPublishedAt
        : null,
    publishedAt: row.publishedAt,
  };
}
