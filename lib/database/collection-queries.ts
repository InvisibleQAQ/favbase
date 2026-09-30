/**
 * Shared read helpers for the platform collection pages. Every platform's
 * paged getter (getBookmarks / getFavorites / getStarredRepos …) carried a
 * byte-identical skeleton — select the same 7 `items` columns, run a parallel
 * `count(*)`, map rows, return `{ rows, total }`. Extracted per audit
 * docs/15 MEDIUM-3 step 2 so each platform only declares its WHERE conditions,
 * ORDER BY, and row mapper. Every getLastSyncedAt delegates to
 * `getPlatformLastSyncedAt`, which reads the Platform Sync Record.
 *
 * Leaf entity imports (not the '@/lib/database' barrel's schema/db side): keeps
 * this loadable in offscreen documents, matching the sync-services.
 */

import { and, sql, type SQL } from 'drizzle-orm';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import type { FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { getPlatformSyncRecord } from '@/lib/database/platform-sync-record';

/** The fixed column set every platform's paged query selects from `items`. */
export interface PagedItemRow {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  platformMeta: unknown;
}

export interface PagedItemsOptions<TItem> {
  /** WHERE terms — platform eq + optional chip / search filters. */
  conditions: (SQL | undefined)[];
  /** ORDER BY expression (e.g. `publishedAt DESC NULLS LAST`). */
  orderBy: SQL;
  /** 1-based page number. */
  page: number;
  pageSize: number;
  /** Row → UI item mapper (platform-specific shape). */
  mapRow: (row: PagedItemRow) => TItem;
}

/**
 * Paged `items` query with a parallel total count. The only per-platform inputs
 * are the WHERE conditions, the ORDER BY, and the row mapper — the select shape,
 * pagination math, and count query are shared here.
 */
export async function pagedItemsQuery<TItem>(
  db: FavbaseDb,
  { conditions, orderBy, page, pageSize, mapRow }: PagedItemsOptions<TItem>,
): Promise<{ rows: TItem[]; total: number }> {
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
      .orderBy(orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(items).where(where),
  ]);

  return { rows: rows.map(mapRow), total: countRows[0]?.total ?? 0 };
}

/**
 * "Last synced" for a platform = the latest SUCCESSFUL Platform Sync in its
 * Platform Sync Record; null when it has never succeeded (no record, or only
 * failed / unfinished attempts). A sync that found nothing still succeeds, so
 * an empty library shows a time too. `sources.lastFetchedAt` is no longer read
 * here: it is each Source's freshness, and a failed or empty sync never moved
 * it (docs/32 high-1).
 */
export async function getPlatformLastSyncedAt(
  platform: CollectionPlatform,
  db: FavbaseDb,
): Promise<Date | null> {
  return (await getPlatformSyncRecord(platform, db))?.lastSuccessAt ?? null;
}
