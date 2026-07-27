/**
 * Bookmarks domain sync service — the ONLY holder of DB schema knowledge for
 * the `bookmarks` platform (mirrors lib/github/github-sync-service.ts and
 * lib/bilibili/bili-sync-service.ts layering). Consumers (hooks / UI) call the
 * high-level operations here and never import drizzle / entities / getDb.
 *
 * Model: bookmark folders → `sources` rows (upserted, like bilibili fav
 * folders), bookmarks → `items` rows (deduped by normalized URL), a bookmark's
 * folder membership → `item_sources` links. A URL bookmarked in several folders
 * yields ONE item and one link per folder.
 *
 * Insert-only ADR (.trellis/spec/frontend/database-bridge.md) applies:
 * items / authors / item_sources are insert-only (`onConflictDoNothing`,
 * first-write-wins). Allowed exception: `sources` rows upsert (title +
 * folderPath + lastFetchedAt freshness). Removed bookmarks are never deleted; a
 * bookmark moved between folders keeps both links (same as bilibili).
 *
 * Content pipeline: new bookmarks land as contentState='pending' and are
 * drained by the extraction worker (./bookmark-content-service.ts) through the
 * queue/update methods at the bottom of this file — fetch page → defuddle →
 * Markdown → item_contents + charSplit chunks → 'chunked', or 'no_content' on
 * permanent failure. Existing content without chunks is rebuilt from
 * item_contents without another fetch. contentState UPDATEs do not violate
 * the insert-only ADR
 * (that constrains row add/delete; bilibili transcription drives the same
 * pending→chunked advance).
 */

import { and, asc, eq, exists, ilike, inArray, not, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemChunks } from '@/lib/database/entities/item-chunks';
import { itemContents } from '@/lib/database/entities/item-contents';
import { itemSources } from '@/lib/database/entities/item-sources';
import { ingestCollection, persistItemContent } from '@/lib/ingest/ingest';
// Leaf import (NOT the '@/lib/embedding' barrel): the barrel eagerly touches
// chrome.storage at module load — same rule as lib/github/github-sync-service.
import { charSplit } from '@/lib/embedding/char-split';
import { readBookmarkTree, type BookmarkTree } from './bookmarks-api';
import type { CooperativeCheckpoint } from '@/lib/collections';

export type { BookmarkTree, BookmarkFolder, BookmarkEntry } from './bookmarks-api';

const PLATFORM = 'bookmarks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface BookmarkItemMeta {
  domain: string;
  /** ms epoch — redundant with publishedAt but kept for lossless round-trip. */
  dateAdded: number;
}

export interface SyncBookmarksResult {
  /** Total bookmarks read from the tree (before URL dedup). */
  totalBookmarks: number;
  /** Distinct items persisted (after URL dedup). */
  syncedItems: number;
  /** Folders that had ≥1 direct bookmark (empty folders are skipped). */
  folders: number;
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface BookmarkItem {
  /** items.id (uuid) */
  id: string;
  /** normalized URL (items.platformItemId) — stable per-page key */
  normalizedUrl: string;
  title: string;
  url: string;
  domain: string;
  /** ms epoch the bookmark was added; null if unknown. */
  dateAdded: number | null;
}

/** Folder chip data — one per folder that has bookmarks. */
export interface BookmarkFolderRef {
  /** chrome folder node id (sources.platformSourceId) — the :folderId route param. */
  folderId: string;
  title: string;
  /** Full path, e.g. "Bookmarks Bar/Tech" (disambiguates same-named folders). */
  path: string;
}

export interface BookmarksQuery {
  /** Restrict to one folder (sources.platformSourceId). Omit = whole library. */
  folderId?: string;
  /** ILIKE match on title or domain. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/** Read the local bookmark tree and persist it. Auto-called on page visit. */
export async function syncBookmarks(
  control?: CooperativeCheckpoint,
): Promise<SyncBookmarksResult> {
  const tree = await readBookmarkTree();
  await control?.checkpoint();
  return syncBookmarkTreeToDb(getDb(), tree);
}

/**
 * Persist a bookmark tree. Exported for tests — production goes through
 * `syncBookmarks`. The transaction skeleton (sources upsert → authors → items
 * → links) is delegated to the shared `ingestCollection` pipeline; this
 * function only declares the normalized rows.
 */
export async function syncBookmarkTreeToDb(
  db: FavbaseDb,
  tree: BookmarkTree,
): Promise<SyncBookmarksResult> {
  if (tree.bookmarks.length === 0) {
    return { totalBookmarks: 0, syncedItems: 0, folders: 0 };
  }

  // Only folders with ≥1 DIRECT bookmark become sources (skip empty +
  // subfolder-only folders — they'd be empty chips). Upsert refreshes title +
  // path + lastFetchedAt (folder renames flow through).
  const usedFolderIds = new Set(tree.bookmarks.map((b) => b.folderId));
  const usedFolders = tree.folders.filter((f) => usedFolderIds.has(f.id));

  // items = distinct by normalized URL (first-write-wins).
  const itemByUrl = new Map<string, (typeof tree.bookmarks)[number]>();
  for (const b of tree.bookmarks) {
    if (!itemByUrl.has(b.normalizedUrl)) itemByUrl.set(b.normalizedUrl, b);
  }

  await ingestCollection(db, {
    platform: PLATFORM,
    sources: usedFolders.map((f) => ({
      platformSourceId: f.id,
      title: f.title,
      platformMeta: { path: f.path },
    })),
    // authors = distinct domains.
    authors: [...new Set(tree.bookmarks.map((b) => b.domain))].map((domain) => ({
      platformAuthorId: domain,
      name: domain,
      avatarUrl: null,
    })),
    items: [...itemByUrl.values()].map((b) => ({
      platformItemId: b.normalizedUrl,
      platformAuthorId: b.domain,
      title: b.title,
      authorName: b.domain,
      originalUrl: b.url,
      publishedAt: b.dateAdded ? new Date(b.dateAdded) : null,
      // Awaiting content extraction (bookmark-content-service drains this).
      contentState: 'pending' as const,
      platformMeta: { domain: b.domain, dateAdded: b.dateAdded } satisfies BookmarkItemMeta,
    })),
    // One link per (bookmark, folder) pair — a URL in multiple folders → one
    // item, multiple links.
    links: tree.bookmarks.map((b) => ({
      platformItemId: b.normalizedUrl,
      platformSourceId: b.folderId,
    })),
  });

  return {
    totalBookmarks: tree.bookmarks.length,
    syncedItems: itemByUrl.size,
    folders: usedFolders.length,
  };
}

// ---------------------------------------------------------------------------
// Public API — queries (the bookmarks page reads from PGlite, never the browser
// bookmarks API directly — that's the sync path)
// ---------------------------------------------------------------------------

/**
 * Paged bookmarks, dateAdded descending (newest first). Optional folder filter
 * (via item_sources join) + ILIKE search over title / domain.
 */
export async function getBookmarks(
  query: BookmarksQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: BookmarkItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      or(ilike(items.title, pattern), sql`${items.platformMeta}->>'domain' ILIKE ${pattern}`),
    );
  }
  if (query.folderId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${itemSources}
        JOIN ${sources} ON ${sources.id} = ${itemSources.sourceId}
        WHERE ${itemSources.itemId} = ${items.id}
          AND ${sources.platform} = ${PLATFORM}
          AND ${sources.platformSourceId} = ${query.folderId}
      )`,
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

/** Folders that have bookmarks, in first-seen (tree) order — the chip row. */
export async function getFolders(db: FavbaseDb = getDb()): Promise<BookmarkFolderRef[]> {
  const rows = await db
    .select({
      platformSourceId: sources.platformSourceId,
      title: sources.title,
      platformMeta: sources.platformMeta,
    })
    .from(sources)
    .where(eq(sources.platform, PLATFORM))
    .orderBy(sources.createdAt);
  return rows.map((r) => ({
    folderId: r.platformSourceId,
    title: r.title,
    path: readPath(r.platformMeta),
  }));
}

/** Latest folder sync time; null = never synced. */
export async function getLastSyncedAt(db: FavbaseDb = getDb()): Promise<Date | null> {
  return getPlatformLastSyncedAt(PLATFORM, db);
}

// ---------------------------------------------------------------------------
// Public API — content extraction queue (bookmark-content-service.ts is the
// sole production caller; the contentState UPDATEs here are the ADR-allowed
// state-machine advance, see the file header)
// ---------------------------------------------------------------------------

/** One item awaiting extraction or durable-content chunk recovery. */
export interface PendingExtractionTarget {
  /** items.id (uuid) — the extraction-state handle. */
  itemId: string;
  /** items.platformItemId (normalized URL) — the embed/tag addressing key. */
  platformItemId: string;
  /** items.originalUrl — what gets fetched. */
  url: string;
  /** Display name captured from the browser bookmark. */
  title: string;
  /** Existing durable text used to repair missing chunks without refetching. */
  storedContent?: string | null;
}

function extractionWorkCondition(db: FavbaseDb): SQL {
  const hasStoredContent = exists(
    db
      .select({ one: sql`1` })
      .from(itemContents)
      .where(
        and(
          eq(itemContents.itemId, items.id),
          sql`NULLIF(BTRIM(${itemContents.plainText}), '') IS NOT NULL`,
        ),
      ),
  );
  const hasNoChunks = not(
    exists(
      db
        .select({ one: sql`1` })
        .from(itemChunks)
        .where(eq(itemChunks.itemId, items.id)),
    ),
  );

  return or(
    eq(items.contentState, 'pending'),
    and(
      inArray(items.contentState, ['chunked', 'has_content', 'no_content']),
      hasStoredContent,
      hasNoChunks,
    ),
  )!;
}

/**
 * Oldest-first slice of the extraction/recovery queue. Transient failures stay
 * 'pending'; rows with stored content and missing chunks are repaired without
 * fetching the page again.
 */
export async function getPendingExtractionTargets(
  limit: number,
  db: FavbaseDb = getDb(),
): Promise<PendingExtractionTarget[]> {
  return db
    .select({
      itemId: items.id,
      platformItemId: items.platformItemId,
      url: items.originalUrl,
      title: items.title,
      storedContent: itemContents.plainText,
    })
    .from(items)
    .leftJoin(itemContents, eq(itemContents.itemId, items.id))
    .where(and(eq(items.platform, PLATFORM), extractionWorkCondition(db)))
    .orderBy(asc(items.createdAt), asc(items.id))
    .limit(limit);
}

/** Extraction/recovery backlog size — the progress `total` for a run. */
export async function countPendingExtractions(db: FavbaseDb = getDb()): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.platform, PLATFORM), extractionWorkCondition(db)));
  return Number(rows[0]?.count ?? 0);
}

/** Permanent extraction failure (dead link / non-HTML / empty shell) — never retried. */
export async function markItemNoContent(itemId: string, db: FavbaseDb = getDb()): Promise<void> {
  await db
    .update(items)
    .set({ contentState: 'no_content', updatedAt: new Date() })
    .where(eq(items.id, itemId));
}

/**
 * Persist extracted Markdown (item_contents + charSplit chunks via the shared
 * two-phase helper — runs OUTSIDE any transaction) and advance contentState to
 * 'chunked'. Whitespace-only markdown (the caller's threshold guard should
 * prevent it) degrades to 'no_content' — a 'chunked' state without chunks
 * would lie. Returns whether chunk rows were durably inserted; only `true`
 * licenses downstream Embed/Tag enqueue.
 */
export async function saveBookmarkContent(
  itemId: string,
  markdown: string,
  db: FavbaseDb = getDb(),
): Promise<boolean> {
  const written = await persistItemContent(db, itemId, markdown, (text) =>
    charSplit(text, { preferParagraph: true }),
  );
  await db
    .update(items)
    .set({ contentState: written ? 'chunked' : 'no_content', updatedAt: new Date() })
    .where(eq(items.id, itemId));
  return written;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function readPath(meta: unknown): string {
  const path = (meta as { path?: unknown } | null)?.path;
  return typeof path === 'string' ? path : '';
}

function toBookmarkItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  platformMeta: unknown;
}): BookmarkItem {
  const meta = (row.platformMeta ?? {}) as Partial<BookmarkItemMeta>;
  return {
    id: row.id,
    normalizedUrl: row.platformItemId,
    title: row.title,
    url: row.originalUrl,
    domain: typeof meta.domain === 'string' ? meta.domain : row.authorName,
    dateAdded: typeof meta.dateAdded === 'number' ? meta.dateAdded : (row.publishedAt?.getTime() ?? null),
  };
}
