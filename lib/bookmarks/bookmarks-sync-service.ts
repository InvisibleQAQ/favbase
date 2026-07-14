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

import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { readBookmarkTree, type BookmarkTree } from './bookmarks-api';

export type { BookmarkTree, BookmarkFolder, BookmarkEntry } from './bookmarks-api';

const PLATFORM = 'bookmarks';
/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;

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
 * `syncBookmarks`. Single transaction, five steps mirroring the github flow:
 * sources upsert → authors insert → items insert → links insert.
 */
export async function syncBookmarkTreeToDb(
  db: FavbaseDb,
  tree: BookmarkTree,
): Promise<SyncBookmarksResult> {
  return db.transaction(async (tx) => {
    if (tree.bookmarks.length === 0) {
      return { totalBookmarks: 0, syncedItems: 0, folders: 0 };
    }

    const now = new Date();

    // 1. Only folders with ≥1 DIRECT bookmark become sources (skip empty +
    //    subfolder-only folders — they'd be empty chips). Upsert refreshes
    //    title + path + lastFetchedAt (folder renames flow through).
    const usedFolderIds = new Set(tree.bookmarks.map((b) => b.folderId));
    const usedFolders = tree.folders.filter((f) => usedFolderIds.has(f.id));

    const sourceValues = usedFolders.map((f) => ({
      platform: PLATFORM,
      platformSourceId: f.id,
      title: f.title,
      platformMeta: { path: f.path },
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
            platformMeta: sql`excluded.platform_meta`,
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

    // 2. authors = distinct domains, insert-only.
    const domainSet = new Set(tree.bookmarks.map((b) => b.domain));
    const authorValues = [...domainSet].map((domain) => ({
      platform: PLATFORM,
      platformAuthorId: domain,
      name: domain,
      avatarUrl: null,
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

    // 3. items = distinct by normalized URL (first-write-wins), insert-only.
    const itemByUrl = new Map<string, (typeof tree.bookmarks)[number]>();
    for (const b of tree.bookmarks) {
      if (!itemByUrl.has(b.normalizedUrl)) itemByUrl.set(b.normalizedUrl, b);
    }

    const itemValues = [...itemByUrl.values()].map((b) => ({
      platform: PLATFORM,
      platformItemId: b.normalizedUrl,
      authorId: authorIdMap.get(b.domain)!,
      title: b.title,
      authorName: b.domain,
      originalUrl: b.url,
      publishedAt: b.dateAdded ? new Date(b.dateAdded) : null,
      contentState: 'no_content' as const,
      platformMeta: { domain: b.domain, dateAdded: b.dateAdded } satisfies BookmarkItemMeta,
    }));
    for (const batch of chunk(itemValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });
    }

    const itemRows = await tx
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

    // 4. item_sources links — one per (bookmark, folder) pair, deduped. A URL
    //    in multiple folders → one item, multiple links.
    const seen = new Set<string>();
    const linkValues: Array<{ itemId: string; sourceId: string }> = [];
    for (const b of tree.bookmarks) {
      const itemId = itemIdMap.get(b.normalizedUrl);
      const sourceId = sourceIdMap.get(b.folderId);
      if (!itemId || !sourceId) continue;
      const key = `${itemId}::${sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      linkValues.push({ itemId, sourceId });
    }
    for (const batch of chunk(linkValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(itemSources).values(batch).onConflictDoNothing();
    }

    return {
      totalBookmarks: tree.bookmarks.length,
      syncedItems: itemValues.length,
      folders: usedFolders.length,
    };
  });
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
  const rows = await db
    .select({ last: sql<Date | null>`max(${sources.lastFetchedAt})` })
    .from(sources)
    .where(eq(sources.platform, PLATFORM));
  return rows[0]?.last ?? null;
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
