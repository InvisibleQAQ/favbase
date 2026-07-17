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
 * Embedding is NOT run inline during sync (D3) — vectorization is deferred to
 * the settings 「重建向量」batch. Full-text (ILIKE) search works right after
 * sync; semantic retrieval after a rebuild.
 *
 * Runs in the app.html page context only (manual sync button → RPC proxy →
 * Offscreen PGlite): the turndown conversion wants a DOM, and the zhihu fetch
 * needs the page's cookie jar via `credentials:'include'`.
 */

import { desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { chunk, escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemContents } from '@/lib/database/entities/item-contents';
// Leaf import (not the '@/lib/embedding' barrel) — same rule as x-sync-service:
// the barrel's ./config re-export touches '@/lib/storage' at module load.
import { replaceItemChunks } from '@/lib/embedding/vector-store';
import {
  fetchAllFavorites,
  type ZhihuCollection,
  type ZhihuItemType,
  type ZhihuProgressCallback,
  type ZhihuRawFavorite,
} from './zhihu-api';
import { htmlToMarkdown } from './zhihu-markdown';
import { chunkZhihuMarkdown } from './zhihu-chunker';

// Re-export what service consumers actually need: structured errors + the
// types appearing in public signatures below.
export { ZhihuAuthError, ZhihuRateLimitError } from './zhihu-api';
export type { ZhihuCollection, ZhihuItemType, ZhihuProgressCallback, ZhihuRawFavorite };

const PLATFORM = 'zhihu';
/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;

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
export async function syncFavorites(onProgress?: ZhihuProgressCallback): Promise<SyncZhihuResult> {
  const db = getDb();
  const { collections, favorites } = await fetchAllFavorites(onProgress);
  return syncFavoritesToDb(db, collections, favorites);
}

/**
 * Persist collections + favorites. Exported for tests — production goes
 * through `syncFavorites`. Structure mirrors the x flow: markdown conversion
 * up front (outside the tx — turndown is CPU work), then a single insert-only
 * transaction (sources upsert → authors → items → links), then content +
 * chunks for the NEWLY inserted items OUTSIDE the tx (replaceItemChunks opens
 * its own transaction — nesting on the single-connection proxy would deadlock).
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

  const insertedItems = await db.transaction(async (tx) => {
    if (collections.length === 0) return [];

    // 1. Upsert ALL public collections as sources (ADR-allowed exception:
    //    title + lastFetchedAt freshness). Empty collections still get a row
    //    so max(lastFetchedAt) can answer "when was the last sync".
    const now = new Date();
    const sourceValues = collections.map((collection) => ({
      platform: PLATFORM,
      platformSourceId: collection.id,
      title: collection.title,
      lastFetchedAt: now,
    }));
    for (const batch of chunk(sourceValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(sources)
        .values(batch)
        .onConflictDoUpdate({
          target: [sources.platform, sources.platformSourceId],
          set: {
            title: sql`excluded.title`,
            lastFetchedAt: sql`excluded.last_fetched_at`,
            updatedAt: sql`NOW()`,
          },
        });
    }

    const sourceRows = await tx
      .select({ id: sources.id, platformSourceId: sources.platformSourceId })
      .from(sources)
      .where(eq(sources.platform, PLATFORM));
    const sourceIdMap = new Map(sourceRows.map((r) => [r.platformSourceId, r.id]));

    if (favorites.length === 0) return [];

    // 2. Authors deduped by author id, insert-only.
    const authorMap = new Map<string, ZhihuRawFavorite['author']>();
    for (const favorite of byId.values()) {
      if (!authorMap.has(favorite.author.id)) authorMap.set(favorite.author.id, favorite.author);
    }
    const authorValues = [...authorMap.values()].map((a) => ({
      platform: PLATFORM,
      platformAuthorId: a.id,
      name: a.name,
      avatarUrl: a.avatarUrl || null,
    }));
    for (const batch of chunk(authorValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(authors)
        .values(batch)
        .onConflictDoNothing({ target: [authors.platform, authors.platformAuthorId] });
    }

    const authorRows = await tx
      .select({ id: authors.id, platformAuthorId: authors.platformAuthorId })
      .from(authors)
      .where(eq(authors.platform, PLATFORM));
    const authorIdMap = new Map(authorRows.map((r) => [r.platformAuthorId, r.id]));

    // 3. Items — insert-only, first-write-wins. Track which platformItemIds
    //    are new so we only persist content for fresh rows.
    const existingRows = await tx
      .select({ platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const preExisting = new Set(existingRows.map((r) => r.platformItemId));

    const itemValues = [...byId.entries()]
      .map(([pid, favorite]) => {
        const authorId = authorIdMap.get(favorite.author.id);
        if (!authorId) return null;
        const markdown = markdownById.get(pid) ?? '';
        return {
          platform: PLATFORM,
          platformItemId: pid,
          authorId,
          title: favorite.title,
          authorName: favorite.author.name,
          originalUrl: favorite.url,
          publishedAt: favorite.createdAt ? new Date(favorite.createdAt * 1000) : null,
          // Text-native platform (D3): body present → chunked; zvideo/empty →
          // no_content (NOT pending — pending feeds auto-transcribe).
          contentState: (markdown ? 'chunked' : 'no_content') as 'chunked' | 'no_content',
          platformMeta: {
            type: favorite.type,
            excerpt: favorite.excerpt,
            authorName: favorite.author.name,
            avatarUrl: favorite.author.avatarUrl,
            thumbnailUrl: favorite.thumbnailUrl,
            collectionId: favorite.collectionId,
            collectionTitle: favorite.collectionTitle,
          } satisfies ZhihuItemMeta,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    for (const batch of chunk(itemValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });
    }

    // 4. Links — one per (item, collection) membership, deduped. An item in
    //    two collections → one item row, two links.
    const itemRows = await tx
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

    const seenLinks = new Set<string>();
    const linkValues: Array<{ itemId: string; sourceId: string }> = [];
    for (const favorite of favorites) {
      const itemId = itemIdMap.get(platformItemIdOf(favorite));
      const sourceId = sourceIdMap.get(favorite.collectionId);
      if (!itemId || !sourceId) continue;
      const key = `${itemId}::${sourceId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      linkValues.push({ itemId, sourceId });
    }
    for (const batch of chunk(linkValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(itemSources).values(batch).onConflictDoNothing();
    }

    const inserted: Array<{ itemId: string; markdown: string }> = [];
    for (const [pid] of byId) {
      if (preExisting.has(pid)) continue;
      const itemId = itemIdMap.get(pid);
      // Every new item counts as inserted; empty markdown (zvideo) simply
      // skips the content persist below.
      if (itemId) inserted.push({ itemId, markdown: markdownById.get(pid) ?? '' });
    }
    return inserted;
  });

  // 5. Persist content + chunks for NEW items only, OUTSIDE the tx (each
  //    replaceItemChunks opens its own transaction; nesting deadlocks the
  //    single-connection proxy). content_state='chunked' set at insert;
  //    embedding deferred (D3).
  for (const { itemId, markdown } of insertedItems) {
    await persistZhihuContent(db, itemId, markdown);
  }

  return {
    total: favorites.length,
    synced: byId.size,
    inserted: insertedItems.length,
    collections: collections.length,
  };
}

/** Persist one item's Markdown body → item_contents + item_chunks. */
async function persistZhihuContent(db: FavbaseDb, itemId: string, markdown: string): Promise<void> {
  const plainText = markdown.trim();
  if (!plainText) return;

  await db
    .insert(itemContents)
    .values({ itemId, plainText })
    .onConflictDoUpdate({ target: itemContents.itemId, set: { plainText, updatedAt: new Date() } });

  await replaceItemChunks(db, itemId, chunkZhihuMarkdown(plainText));
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

function toFavoriteItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  platformMeta: unknown;
}): ZhihuFavoriteItem {
  const meta = (row.platformMeta ?? {}) as Partial<ZhihuItemMeta>;
  return {
    id: row.id,
    platformItemId: row.platformItemId,
    type: ZHIHU_TYPES.includes(meta.type as ZhihuItemType) ? (meta.type as ZhihuItemType) : 'answer',
    title: row.title,
    excerpt: typeof meta.excerpt === 'string' ? meta.excerpt : '',
    authorName: typeof meta.authorName === 'string' ? meta.authorName : row.authorName,
    avatarUrl: typeof meta.avatarUrl === 'string' && meta.avatarUrl ? meta.avatarUrl : null,
    originalUrl: row.originalUrl,
    thumbnailUrl: typeof meta.thumbnailUrl === 'string' && meta.thumbnailUrl ? meta.thumbnailUrl : null,
    collectionTitle: typeof meta.collectionTitle === 'string' ? meta.collectionTitle : '',
    publishedAt: row.publishedAt,
  };
}
