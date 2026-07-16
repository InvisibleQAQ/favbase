/**
 * X (Twitter) bookmarks domain sync service — the ONLY holder of DB schema
 * knowledge for the `x` platform (mirrors lib/github/github-sync-service.ts and
 * lib/bilibili/bili-sync-service.ts layering). Consumers (hooks / UI) call the
 * high-level operations here and never import drizzle / entities / getDb.
 *
 * Model: one `sources` row (`platformSourceId='bookmarks'`), tweet authors →
 * `authors` rows, bookmarked tweets → `items` rows, tweet full_text →
 * `item_contents` + `item_chunks` with `content_state='chunked'`.
 *
 * Insert-only ADR (.trellis/spec/frontend/database-bridge.md) applies:
 * items / authors / item_sources are insert-only (`onConflictDoNothing`,
 * first-write-wins). Allowed exception: the single `sources` row upserts to
 * refresh lastFetchedAt. Un-bookmarked tweets are never deleted.
 *
 * Embedding is NOT run inline during sync (D3 — a bulk sync of thousands of
 * bookmarks would hammer the embedding provider). Content is persisted +
 * chunked → `content_state='chunked'`; vectorization is deferred to the
 * settings 「重建向量」batch (`rebuildPendingEmbeddings`). Full-text (ILIKE)
 * search works right after sync; semantic retrieval after a rebuild.
 */

import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemContents } from '@/lib/database/entities/item-contents';
// Leaf import (not the '@/lib/embedding' barrel): the barrel re-exports
// ./config → '@/lib/storage', whose module-load `storage.defineItem` calls
// eagerly hit chrome.storage — which offscreen documents (where this sync also
// runs) don't have. Same rule as x-auth.ts importing '@/lib/storage/keys'.
import { replaceItemChunks } from '@/lib/embedding/vector-store';
import {
  fetchAllBookmarks,
  XAuthError,
  type XAuth,
  type XRawBookmark,
  type XMedia,
  type BookmarksProgressCallback,
} from './x-api';
import { chunkTweetText } from './x-chunker';

// Re-export what service consumers actually need: structured errors + the types
// appearing in public signatures below.
export { XAuthError, XRateLimitError } from './x-api';
export type { XRawBookmark, BookmarksProgressCallback } from './x-api';

const PLATFORM = 'x';
const BOOKMARKS_SOURCE_ID = 'bookmarks';
const BOOKMARKS_SOURCE_TITLE = 'X Bookmarks';
/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;
/** Card title = first N chars of the tweet text (full text lives in platformMeta). */
const TITLE_MAX_CHARS = 140;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface XItemMeta {
  text: string;
  authorHandle: string;
  authorName: string;
  avatarUrl: string;
  media: XMedia[];
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  lang: string;
}

export interface SyncBookmarksResult {
  total: number;
  synced: number;
  /** Items newly inserted this run (content persisted for these only). */
  inserted: number;
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface XBookmarkItem {
  /** items.id (uuid) */
  id: string;
  /** tweet rest_id (items.platformItemId) */
  tweetId: string;
  /** truncated card title */
  title: string;
  /** full tweet text */
  text: string;
  authorName: string;
  authorHandle: string;
  avatarUrl: string | null;
  originalUrl: string;
  media: XMedia[];
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  lang: string;
  publishedAt: Date | null;
}

export interface BookmarksQuery {
  /** Exact match on author handle (chip filter). */
  author?: string;
  /** ILIKE match on title / text / author name. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

export interface AuthorCount {
  authorName: string;
  authorHandle: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/**
 * One-shot bookmarks sync: fetch ALL bookmarks (paged, paced, incremental
 * stop-on-known-id) → persist insert-only. `auth` must be resolved by the
 * CALLER via `getXAuth()` — offscreen documents have no `chrome.storage`, so
 * only storage-capable contexts (app.html page, background SW) can read the
 * captured tokens. Throws XAuthError when auth is null (not logged in / not
 * captured yet); fetch/rate-limit errors propagate to the caller.
 */
export async function syncBookmarks(
  auth: XAuth | null,
  onProgress?: BookmarksProgressCallback,
): Promise<SyncBookmarksResult> {
  if (!auth) throw new XAuthError('Not logged in to x.com', 'no-token');

  const db = getDb();

  // Incremental: build the stop predicate from already-stored tweet ids.
  const known = await getKnownTweetIds(db);
  const shouldStop = (id: string) => known.has(id);

  const bookmarks = await fetchAllBookmarks(auth, onProgress, { shouldStop });
  return syncBookmarksToDb(db, bookmarks);
}

/** Set of already-stored tweet ids (platform='x') — the incremental cutoff. */
async function getKnownTweetIds(db: FavbaseDb): Promise<Set<string>> {
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(eq(items.platform, PLATFORM));
  return new Set(rows.map((r) => r.platformItemId));
}

/**
 * Persist bookmarks. Exported for tests — production goes through
 * `syncBookmarks`. Structure mirrors the github flow: a single insert-only
 * transaction (sources upsert → authors → items → links), then content +
 * chunks for the NEWLY inserted items OUTSIDE the tx (replaceItemChunks opens
 * its own transaction — nesting on the single-connection proxy would deadlock).
 */
export async function syncBookmarksToDb(
  db: FavbaseDb,
  bookmarks: XRawBookmark[],
): Promise<SyncBookmarksResult> {
  const insertedItemIds = await db.transaction(async (tx) => {
    // 1. Upsert the single "bookmarks" source (ADR-allowed exception:
    //    lastFetchedAt freshness). Runs even for an empty list so the UI can
    //    distinguish "never synced" from "synced, empty".
    const sourceRows = await tx
      .insert(sources)
      .values({
        platform: PLATFORM,
        platformSourceId: BOOKMARKS_SOURCE_ID,
        title: BOOKMARKS_SOURCE_TITLE,
        lastFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sources.platform, sources.platformSourceId],
        set: { lastFetchedAt: sql`excluded.last_fetched_at`, updatedAt: sql`NOW()` },
      })
      .returning({ id: sources.id });
    const sourceId = sourceRows[0].id;

    if (bookmarks.length === 0) return [];

    // 2. Authors deduped by rest_id, insert-only.
    const authorMap = new Map<string, XRawBookmark['author']>();
    for (const b of bookmarks) {
      if (b.author.restId && !authorMap.has(b.author.restId)) {
        authorMap.set(b.author.restId, b.author);
      }
    }
    const authorValues = [...authorMap.values()].map((a) => ({
      platform: PLATFORM,
      platformAuthorId: a.restId,
      name: a.name || a.handle,
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

    // 3. Items — insert-only, first-write-wins. Track which platformItemIds are
    //    new (existed before this run = not new) so we only persist content for
    //    fresh rows.
    const existingRows = await tx
      .select({ platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const preExisting = new Set(existingRows.map((r) => r.platformItemId));

    // Dedupe within this batch (a tweet can appear once, but be defensive).
    const byId = new Map<string, XRawBookmark>();
    for (const b of bookmarks) if (!byId.has(b.id)) byId.set(b.id, b);

    const itemValues = [...byId.values()]
      .map((b) => {
        const authorId = authorIdMap.get(b.author.restId);
        if (!authorId) return null;
        return {
          platform: PLATFORM,
          platformItemId: b.id,
          authorId,
          title: b.text.slice(0, TITLE_MAX_CHARS) || b.author.handle,
          authorName: b.author.name || b.author.handle,
          originalUrl: b.url,
          publishedAt: b.createdAt ? new Date(b.createdAt) : null,
          contentState: 'chunked' as const,
          platformMeta: {
            text: b.text,
            authorHandle: b.author.handle,
            authorName: b.author.name,
            avatarUrl: b.author.avatarUrl,
            media: b.media,
            likeCount: b.likeCount,
            retweetCount: b.retweetCount,
            replyCount: b.replyCount,
            lang: b.lang,
          } satisfies XItemMeta,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    for (const batch of chunk(itemValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });
    }

    // 4. Build tweetId → item id map, insert item_sources links.
    const itemRows = await tx
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

    const linkValues: Array<{ itemId: string; sourceId: string }> = [];
    const inserted: Array<{ itemId: string; text: string }> = [];
    for (const b of byId.values()) {
      const itemId = itemIdMap.get(b.id);
      if (!itemId) continue;
      linkValues.push({ itemId, sourceId });
      if (!preExisting.has(b.id)) inserted.push({ itemId, text: b.text });
    }
    for (const batch of chunk(linkValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(itemSources).values(batch).onConflictDoNothing();
    }

    return inserted;
  });

  // 5. Persist content + chunks for NEW items only, OUTSIDE the tx (each
  //    replaceItemChunks opens its own transaction; nesting deadlocks the
  //    single-connection proxy). content_state='chunked' — embedding deferred.
  for (const { itemId, text } of insertedItemIds) {
    await persistTweetContent(db, itemId, text);
  }

  return {
    total: bookmarks.length,
    synced: bookmarks.length,
    inserted: insertedItemIds.length,
  };
}

/**
 * Persist one tweet's text → item_contents + item_chunks, leaving the item at
 * content_state='chunked' (already set at insert; re-affirmed defensively).
 * Embedding is deferred to the settings 「重建向量」batch (D3).
 */
async function persistTweetContent(db: FavbaseDb, itemId: string, text: string): Promise<void> {
  const plainText = text.trim();
  if (!plainText) return;

  await db
    .insert(itemContents)
    .values({ itemId, plainText })
    .onConflictDoUpdate({ target: itemContents.itemId, set: { plainText, updatedAt: new Date() } });

  await replaceItemChunks(db, itemId, chunkTweetText(plainText));
}

// ---------------------------------------------------------------------------
// Public API — queries (X collections page reads from PGlite, not the API)
// ---------------------------------------------------------------------------

/**
 * Paged bookmarks, publishedAt descending (newest first). Optional author chip
 * filter (handle) + ILIKE search over title / full text / author name.
 */
export async function getBookmarks(
  query: BookmarksQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: XBookmarkItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];

  if (query.author) {
    conditions.push(sql`${items.platformMeta}->>'authorHandle' = ${query.author}`);
  }
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      or(
        ilike(items.title, pattern),
        ilike(items.authorName, pattern),
        sql`${items.platformMeta}->>'text' ILIKE ${pattern}`,
      ),
    );
  }

  const where = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: items.id,
        platformItemId: items.platformItemId,
        title: items.title,
        authorName: items.authorName,
        originalUrl: items.originalUrl,
        publishedAt: items.publishedAt,
        platformMeta: items.platformMeta,
      })
      .from(items)
      .where(where)
      .orderBy(sql`${items.publishedAt} DESC NULLS LAST`)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(items).where(where),
  ]);

  return {
    rows: rows.map(toBookmarkItem),
    total: countRows[0]?.total ?? 0,
  };
}

/** Distinct authors with bookmark counts, descending — data for the chip row. */
export async function getAuthorCounts(db: FavbaseDb = getDb()): Promise<AuthorCount[]> {
  const nameExpr = sql`${items.platformMeta}->>'authorName'`;
  const handleExpr = sql`${items.platformMeta}->>'authorHandle'`;
  const rows = await db
    .select({
      authorName: sql<string>`${nameExpr}`,
      authorHandle: sql<string>`${handleExpr}`,
      count: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(and(eq(items.platform, PLATFORM), sql`${handleExpr} IS NOT NULL`))
    .groupBy(nameExpr, handleExpr)
    .orderBy(desc(sql`count(*)`), handleExpr);
  return rows;
}

/** When bookmarks were last synced; null = never synced. */
export async function getLastSyncedAt(db: FavbaseDb = getDb()): Promise<Date | null> {
  const rows = await db
    .select({ lastFetchedAt: sources.lastFetchedAt })
    .from(sources)
    .where(and(eq(sources.platform, PLATFORM), eq(sources.platformSourceId, BOOKMARKS_SOURCE_ID)))
    .limit(1);
  return rows[0]?.lastFetchedAt ?? null;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Escape LIKE/ILIKE metacharacters in user input (default `\` escape char). */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

function toBookmarkItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  platformMeta: unknown;
}): XBookmarkItem {
  const meta = (row.platformMeta ?? {}) as Partial<XItemMeta>;
  return {
    id: row.id,
    tweetId: row.platformItemId,
    title: row.title,
    text: typeof meta.text === 'string' ? meta.text : row.title,
    authorName: typeof meta.authorName === 'string' ? meta.authorName : row.authorName,
    authorHandle: typeof meta.authorHandle === 'string' ? meta.authorHandle : '',
    avatarUrl: typeof meta.avatarUrl === 'string' && meta.avatarUrl ? meta.avatarUrl : null,
    originalUrl: row.originalUrl,
    media: Array.isArray(meta.media) ? meta.media : [],
    likeCount: typeof meta.likeCount === 'number' ? meta.likeCount : 0,
    retweetCount: typeof meta.retweetCount === 'number' ? meta.retweetCount : 0,
    replyCount: typeof meta.replyCount === 'number' ? meta.replyCount : 0,
    lang: typeof meta.lang === 'string' ? meta.lang : '',
    publishedAt: row.publishedAt,
  };
}
