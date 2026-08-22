/**
 * Zhihu favorites domain sync service — the ONLY holder of DB schema knowledge
 * for the `zhihu` platform (mirrors lib/x/x-sync-service.ts layering).
 * Consumers (hooks / UI) call the high-level operations here and never import
 * drizzle / entities / getDb.
 *
 * Model (multi-source, like bookmarks folders): each public collection
 * (收藏夹) → one `sources` row, content authors → `authors` rows, favorited
 * entries → `items` rows (deduped by `type:id` across collections), an entry's
 * collection membership → `item_sources` links. Answer/article/pin bodies are
 * converted to Markdown (turndown) → `item_contents` + chunked `item_chunks`
 * with `content_state='chunked'`; zvideo has no body → `'no_content'`.
 *
 * Insert-only ADR (.trellis/spec/frontend/database-bridge.md) applies:
 * items / authors / item_sources are insert-only (`onConflictDoNothing`,
 * first-write-wins). Allowed exception: `sources` rows upsert (title +
 * lastFetchedAt freshness — collection renames flow through). Un-favorited
 * entries are never deleted.
 *
 * Auto-tag + auto-embed are NOT fired here (ST3): the trigger was moved UP into
 * the app.html hook (`use-zhihu-favorites.ts`) so all four collection platforms
 * register embed/tag as `startJob` background jobs from a single seam (the hook
 * layer) with done/total progress. This wrapper only fetches + persists; the
 * settings 「重建向量」batch remains the backlog safety net for embedding.
 * Full-text (ILIKE) search works right after sync either way.
 *
 * Runs in the app.html page context only (manual sync button → RPC proxy →
 * Offscreen PGlite): the turndown conversion wants a DOM, and the zhihu fetch
 * needs the page's cookie jar via `credentials:'include'`.
 */

import { desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { ingestCollection } from '@/lib/ingest/ingest';
import {
  fetchAllFavorites,
  type ZhihuCollection,
  type ZhihuItemType,
  type ZhihuProgressCallback,
  type ZhihuRawFavorite,
} from './zhihu-api';
import { htmlToMarkdown } from './zhihu-markdown';
// Leaf import, never the '@/lib/embedding' barrel (its value re-export of
// './config' reaches '@/lib/storage' at module load). Guarded by
// tests/lib-import-smoke.test.ts.
import { charSplit } from '@/lib/embedding/char-split';
import type { CooperativeCheckpoint } from '@/lib/collections';

// Re-export what service consumers actually need: structured errors + the
// types appearing in public signatures below.
export { ZhihuAuthError, ZhihuRateLimitError } from './zhihu-api';
export type { ZhihuCollection, ZhihuItemType, ZhihuProgressCallback, ZhihuRawFavorite };

const PLATFORM = 'zhihu';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface ZhihuItemMeta {
  type: ZhihuItemType;
  excerpt: string;
  authorName: string;
  avatarUrl: string;
  thumbnailUrl: string | null;
  /** First-seen collection membership (display); filtering uses item_sources. */
  collectionId: string;
  collectionTitle: string;
}

export interface SyncZhihuResult {
  /** Favorite entries fetched (an item in 2 collections counts twice). */
  total: number;
  /** Distinct items after cross-collection dedupe. */
  synced: number;
  /** Items newly inserted this run (content persisted for these only). */
  inserted: number;
  /** Public collections found. */
  collections: number;
  /** platformItemIds whose content was persisted this run — auto-tagging input. */
  newItemIds: string[];
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface ZhihuFavoriteItem {
  /** items.id (uuid) */
  id: string;
  /** `type:id` (items.platformItemId) */
  platformItemId: string;
  type: ZhihuItemType;
  title: string;
  excerpt: string;
  authorName: string;
  avatarUrl: string | null;
  originalUrl: string;
  thumbnailUrl: string | null;
  collectionTitle: string;
  publishedAt: Date | null;
}

export interface ZhihuQuery {
  /** Restrict to one collection (sources.platformSourceId). Omit = whole library. */
  collectionId?: string;
  /** ILIKE match on title / excerpt / author name. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

/** Collection chip data — one per collection that has items. */
export interface ZhihuCollectionCount {
  collectionId: string;
  title: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/** Stable dedupe key: content types have separate id namespaces on zhihu. */
function platformItemIdOf(favorite: ZhihuRawFavorite): string {
  return `${favorite.type}:${favorite.id}`;
}

/**
 * One-shot favorites sync: fetch the logged-in user's public collections and
 * every item (serial, paced) → persist insert-only. Throws ZhihuAuthError when
 * not logged in to zhihu.com; rate-limit / fetch errors propagate.
 */
export async function syncFavorites(
  onProgress?: ZhihuProgressCallback,
  control?: CooperativeCheckpoint,
): Promise<SyncZhihuResult> {
  const db = getDb();
  const { collections, favorites } = await fetchAllFavorites(onProgress, control);
  // Auto-tag / auto-embed are fired by the caller (use-zhihu-favorites hook)
  // via `startJob`, NOT here — see the module docstring (ST3 trigger move).
  return syncFavoritesToDb(db, collections, favorites);
}

/**
 * Persist collections + favorites. Exported for tests — production goes
 * through `syncFavorites`. Markdown conversion happens up front (outside the
 * tx — turndown is CPU work); the transaction skeleton (sources upsert →
 * authors → items → links → two-phase content write) is delegated to the
 * shared `ingestCollection` pipeline.
 */
export async function syncFavoritesToDb(
  db: FavbaseDb,
  collections: ZhihuCollection[],
  favorites: ZhihuRawFavorite[],
): Promise<SyncZhihuResult> {
  // Dedupe items across collections (first-seen wins) + convert bodies to
  // Markdown BEFORE the transaction (keep the tx short).
  const byId = new Map<string, ZhihuRawFavorite>();
  for (const favorite of favorites) {
    const pid = platformItemIdOf(favorite);
    if (!byId.has(pid)) byId.set(pid, favorite);
  }
  const markdownById = new Map<string, string>();
  for (const [pid, favorite] of byId) {
    markdownById.set(pid, favorite.contentHtml ? htmlToMarkdown(favorite.contentHtml) : '');
  }

  if (collections.length === 0) {
    return { total: favorites.length, synced: byId.size, inserted: 0, collections: 0, newItemIds: [] };
  }

  const result = await ingestCollection(db, {
    platform: PLATFORM,
    // ALL public collections become sources — empty collections still get a
    // row so max(lastFetchedAt) can answer "when was the last sync".
    sources: collections.map((collection) => ({
      platformSourceId: collection.id,
      title: collection.title,
    })),
    authors: [...byId.values()].map((favorite) => ({
      platformAuthorId: favorite.author.id,
      name: favorite.author.name,
      avatarUrl: favorite.author.avatarUrl || null,
    })),
    items: [...byId.entries()].map(([pid, favorite]) => ({
      platformItemId: pid,
      platformAuthorId: favorite.author.id,
      title: favorite.title,
      authorName: favorite.author.name,
      originalUrl: favorite.url,
      publishedAt: favorite.createdAt ? new Date(favorite.createdAt * 1000) : null,
      // Text-native platform (D3): body present → chunked; zvideo/empty →
      // no_content (NOT pending — pending feeds auto-transcribe).
      contentState: markdownById.get(pid) ? ('chunked' as const) : ('no_content' as const),
      platformMeta: {
        type: favorite.type,
        excerpt: favorite.excerpt,
        authorName: favorite.author.name,
        avatarUrl: favorite.author.avatarUrl,
        thumbnailUrl: favorite.thumbnailUrl,
        collectionId: favorite.collectionId,
        collectionTitle: favorite.collectionTitle,
      } satisfies ZhihuItemMeta,
    })),
    // One link per (item, collection) membership — an item in two collections
    // → one item row, two links.
    links: favorites.map((favorite) => ({
      platformItemId: platformItemIdOf(favorite),
      platformSourceId: favorite.collectionId,
    })),
    // Empty markdown (zvideo) still counts as inserted; the pipeline skips
    // the content persist for it.
    content: {
      textOf: (pid) => markdownById.get(pid) ?? '',
      chunk: (text) => charSplit(text, { preferParagraph: true }),
    },
  });

  return {
    total: favorites.length,
    synced: byId.size,
    inserted: result.inserted.length,
    collections: collections.length,
    newItemIds: result.contentPersisted,
  };
}

// ---------------------------------------------------------------------------
// Public API — queries (zhihu collections page reads from PGlite, not the API)
// ---------------------------------------------------------------------------

/**
 * Paged favorites, publishedAt descending (newest first). Optional collection
 * chip filter (via item_sources join) + ILIKE search over title / excerpt /
 * author name.
 */
export async function getFavorites(
  query: ZhihuQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: ZhihuFavoriteItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];

  if (query.collectionId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${itemSources}
        JOIN ${sources} ON ${sources.id} = ${itemSources.sourceId}
        WHERE ${itemSources.itemId} = ${items.id}
          AND ${sources.platform} = ${PLATFORM}
          AND ${sources.platformSourceId} = ${query.collectionId}
      )`,
    );
  }
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      or(
        ilike(items.title, pattern),
        ilike(items.authorName, pattern),
        sql`${items.platformMeta}->>'excerpt' ILIKE ${pattern}`,
      ),
    );
  }

  return pagedItemsQuery(db, {
    conditions,
    orderBy: sql`${items.publishedAt} DESC NULLS LAST`,
    page: query.page,
    pageSize: query.pageSize,
    mapRow: toFavoriteItem,
  });
}

/** Collections that have items, with counts descending — data for the chip row. */
export async function getCollectionCounts(
  db: FavbaseDb = getDb(),
): Promise<ZhihuCollectionCount[]> {
  const rows = await db
    .select({
      collectionId: sources.platformSourceId,
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

/** Latest collection sync time; null = never synced. */
export async function getLastSyncedAt(db: FavbaseDb = getDb()): Promise<Date | null> {
  return getPlatformLastSyncedAt(PLATFORM, db);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const ZHIHU_TYPES: readonly ZhihuItemType[] = ['answer', 'article', 'pin', 'zvideo'];

/**
 * Defensive platformMeta → ZhihuFavoriteItem field narrowing, the SINGLE source
 * of truth shared by the query mapRow (below) and the section tagged-zhihu-card
 * adapter. Envelope fields (id/platformItemId/title/originalUrl/publishedAt)
 * stay at each call site; authorName falls back to the row's own authorName.
 */
export type NarrowedZhihuMeta = Omit<
  ZhihuFavoriteItem,
  'id' | 'platformItemId' | 'title' | 'originalUrl' | 'publishedAt'
>;

export function narrowZhihuMeta(meta: unknown, fb: { authorName: string }): NarrowedZhihuMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  return {
    type: ZHIHU_TYPES.includes(m.type as ZhihuItemType) ? (m.type as ZhihuItemType) : 'answer',
    excerpt: typeof m.excerpt === 'string' ? m.excerpt : '',
    authorName: typeof m.authorName === 'string' ? m.authorName : fb.authorName,
    avatarUrl: typeof m.avatarUrl === 'string' && m.avatarUrl ? m.avatarUrl : null,
    thumbnailUrl: typeof m.thumbnailUrl === 'string' && m.thumbnailUrl ? m.thumbnailUrl : null,
    collectionTitle: typeof m.collectionTitle === 'string' ? m.collectionTitle : '',
  };
}

function toFavoriteItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  platformMeta: unknown;
}): ZhihuFavoriteItem {
  return {
    id: row.id,
    platformItemId: row.platformItemId,
    title: row.title,
    originalUrl: row.originalUrl,
    publishedAt: row.publishedAt,
    ...narrowZhihuMeta(row.platformMeta, { authorName: row.authorName }),
  };
}
