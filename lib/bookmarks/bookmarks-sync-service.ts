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
 */

import { eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { ingestCollection } from '@/lib/ingest/ingest';
import { readBookmarkTree, type BookmarkTree } from './bookmarks-api';

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
export async function syncBookmarks(): Promise<SyncBookmarksResult> {
  const tree = await readBookmarkTree();
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
      contentState: 'no_content' as const,
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
