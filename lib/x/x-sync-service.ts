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
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { items } from '@/lib/database/entities/items';
import { ingestCollection } from '@/lib/ingest/ingest';
import {
  fetchAllBookmarks,
  XAuthError,
  type XAuth,
  type XRawBookmark,
  type XMedia,
  type BookmarksProgressCallback,
} from './x-api';
// Leaf import, never the '@/lib/embedding' barrel (its value re-export of
// './config' reaches '@/lib/storage' at module load). lib-layer platform
// services must not import storage-backed barrels; guarded by
// tests/lib-import-smoke.test.ts.
import { charSplit } from '@/lib/embedding/char-split';
import { envNumber } from '@/lib/env';
import type { CooperativeCheckpoint } from '@/lib/collections';

// Re-export what service consumers actually need: structured errors + the types
// appearing in public signatures below.
export { XAuthError, XRateLimitError } from './x-api';
export type { XRawBookmark, BookmarksProgressCallback } from './x-api';

const PLATFORM = 'x';
const BOOKMARKS_SOURCE_ID = 'bookmarks';
const BOOKMARKS_SOURCE_TITLE = 'X Bookmarks';
/** Card title = first N chars of the tweet text (full text lives in platformMeta). */
const TITLE_MAX_CHARS = envNumber('VITE_X_TITLE_MAX_CHARS', 140);

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
  /**
   * platformItemIds whose content was persisted this run — auto-tagging +
   * auto-embed input. The trigger lives in the app.html CALLER
   * (use-x-bookmarks syncFn), NOT here: the tagging/embedding barrels resolve
   * LLM/embedding config from chrome.storage, which this lib-layer service
   * must not reach (tests/lib-import-smoke.test.ts).
   */
  newItemIds: string[];
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
 * CALLER via `getXAuth()` — this service stays storage-free (it never reads
 * chrome.storage itself); only storage-capable contexts (app.html page,
 * background SW) read the captured tokens and pass them in. Throws XAuthError
 * when auth is null (not logged in / not
 * captured yet); fetch/rate-limit errors propagate to the caller.
 */
export async function syncBookmarks(
  auth: XAuth | null,
  onProgress?: BookmarksProgressCallback,
  control?: CooperativeCheckpoint,
): Promise<SyncBookmarksResult> {
  if (!auth) throw new XAuthError('Not logged in to x.com', 'no-token');

  const db = getDb();

  // Incremental: build the stop predicate from already-stored tweet ids.
  const known = await getKnownTweetIds(db);
  const shouldStop = (id: string) => known.has(id);

  const bookmarks = await fetchAllBookmarks(auth, onProgress, { shouldStop, control });
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
 * `syncBookmarks`. The transaction skeleton (sources upsert → authors → items
 * → links → two-phase content write) is delegated to the shared
 * `ingestCollection` pipeline; this function only declares the normalized rows.
 */
export async function syncBookmarksToDb(
  db: FavbaseDb,
  bookmarks: XRawBookmark[],
): Promise<SyncBookmarksResult> {
  // Dedupe within this batch (a tweet can appear once, but be defensive).
  const byId = new Map<string, XRawBookmark>();
  for (const b of bookmarks) if (!byId.has(b.id)) byId.set(b.id, b);

  const result = await ingestCollection(db, {
    platform: PLATFORM,
    // The single "bookmarks" source upserts even for an empty list so the UI
    // can distinguish "never synced" from "synced, empty".
    sources: [{ platformSourceId: BOOKMARKS_SOURCE_ID, title: BOOKMARKS_SOURCE_TITLE }],
    authors: [...byId.values()]
      .filter((b) => b.author.restId)
      .map((b) => ({
        platformAuthorId: b.author.restId,
        name: b.author.name || b.author.handle,
        avatarUrl: b.author.avatarUrl || null,
      })),
    items: [...byId.values()].map((b) => ({
      platformItemId: b.id,
      platformAuthorId: b.author.restId,
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
    })),
    links: [...byId.keys()].map((tweetId) => ({
      platformItemId: tweetId,
      platformSourceId: BOOKMARKS_SOURCE_ID,
    })),
    content: {
      textOf: (tweetId) => byId.get(tweetId)?.text ?? '',
      chunk: (text) => charSplit(text, { preferParagraph: false }),
    },
  });

  return {
    total: bookmarks.length,
    synced: bookmarks.length,
    inserted: result.inserted.length,
    newItemIds: result.contentPersisted,
  };
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

  return pagedItemsQuery(db, {
    conditions,
    orderBy: sql`${items.publishedAt} DESC NULLS LAST`,
    page: query.page,
    pageSize: query.pageSize,
    mapRow: toBookmarkItem,
  });
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
  return getPlatformLastSyncedAt(PLATFORM, db);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Defensive platformMeta → XBookmarkItem field narrowing, the SINGLE source of
 * truth shared by the query mapRow (below) and the section tagged-tweet-card
 * adapter. Envelope fields (id/tweetId/title/originalUrl/publishedAt) stay at
 * each call site; text falls back to the row's title, authorName to the row's
 * own authorName.
 */
export type NarrowedXMeta = Omit<
  XBookmarkItem,
  'id' | 'tweetId' | 'title' | 'originalUrl' | 'publishedAt'
>;

/** Narrow the loose platformMeta.media into XMedia[] (drop malformed entries). */
function narrowMedia(raw: unknown): XMedia[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is XMedia =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as XMedia).type === 'string' &&
        typeof (m as XMedia).url === 'string',
    )
    .map((m) => ({ type: m.type, url: m.url }));
}

export function narrowXMeta(
  meta: unknown,
  fb: { title: string; authorName: string },
): NarrowedXMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  return {
    text: typeof m.text === 'string' ? m.text : fb.title,
    authorName: typeof m.authorName === 'string' ? m.authorName : fb.authorName,
    authorHandle: typeof m.authorHandle === 'string' ? m.authorHandle : '',
    avatarUrl: typeof m.avatarUrl === 'string' && m.avatarUrl ? m.avatarUrl : null,
    media: narrowMedia(m.media),
    likeCount: typeof m.likeCount === 'number' ? m.likeCount : 0,
    retweetCount: typeof m.retweetCount === 'number' ? m.retweetCount : 0,
    replyCount: typeof m.replyCount === 'number' ? m.replyCount : 0,
    lang: typeof m.lang === 'string' ? m.lang : '',
  };
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
  return {
    id: row.id,
    tweetId: row.platformItemId,
    title: row.title,
    originalUrl: row.originalUrl,
    publishedAt: row.publishedAt,
    ...narrowXMeta(row.platformMeta, { title: row.title, authorName: row.authorName }),
  };
}
