/**
 * Shared read helpers for the platform collection pages, plus the query
 * fragments every platform sync-service used to copy. Every platform's paged
 * getter (getBookmarks / getFavorites / getStarredRepos …) carried a
 * byte-identical skeleton — select the same 7 `items` columns, run a parallel
 * `count(*)`, map rows, return `{ rows, total }`. Extracted per audit
 * docs/15 MEDIUM-3 step 2 so each platform only declares its WHERE conditions,
 * ORDER BY, and row mapper. docs/32 Step 9 moved the repeated fragments here
 * too: the search condition (the platform declares only WHICH fields are
 * searchable), the Source-membership condition, the per-Source item counts and
 * the platform's known-item-id set (the sync paths' incremental cutoff and
 * ingest's pre-existing diff).
 *
 * The builders take `platform: string`, like `IngestInput.platform`, so a new
 * platform's lib layer can be built and tested before its id joins
 * `COLLECTION_PLATFORMS` (platform-onboarding.md §4). Zero platform literals.
 *
 * Leaf entity imports (not the '@/lib/database' barrel's schema/db side): keeps
 * this loadable in offscreen documents, matching the sync-services.
 */

import { and, desc, eq, ilike, or, sql, type Column, type SQL } from 'drizzle-orm';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import type { FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { sources } from '@/lib/database/entities/sources';
import { getPlatformSyncRecord } from '@/lib/database/platform-sync-record';
import { escapeLike } from '@/lib/database/sql-utils';

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

// ---------------------------------------------------------------------------
// Query fragments (docs/32 Step 9). The optional filters return `undefined`
// when inactive, so callers push them unconditionally: `and()` drops
// `undefined`, which keeps the bind-param numbering of the remaining terms.
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring search over `targets`, OR-ed. Blank or
 * whitespace-only `search` = no condition. The term is trimmed and its LIKE
 * metacharacters escaped (`escapeLike` — the only ILIKE-injection guard), so
 * a platform declares only which fields are searchable: a column, or a
 * `platform_meta` field as `` sql`${items.platformMeta}->>'key'` ``.
 */
export function searchCondition(
  search: string | undefined,
  targets: (Column | SQL)[],
): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const pattern = `%${escapeLike(term)}%`;
  return or(...targets.map((target) => ilike(target, pattern)));
}

/**
 * Membership in one Source (folder / collection / playlist) through
 * `item_sources` — every Source filter goes through the link table, never a
 * first-seen Source in `platform_meta` (platform-onboarding.md §4.3). An empty
 * `platformSourceId` (no chip selected) = no condition.
 */
export function sourceMembership(
  platform: string,
  platformSourceId: string | null | undefined,
): SQL | undefined {
  if (!platformSourceId) return undefined;
  // The template's inner whitespace is part of the SQL text; it is kept
  // byte-identical to the three call sites it replaced (docs/32 Step 9).
  return sql`EXISTS (
        SELECT 1 FROM ${itemSources}
        JOIN ${sources} ON ${sources.id} = ${itemSources.sourceId}
        WHERE ${itemSources.itemId} = ${items.id}
          AND ${sources.platform} = ${platform}
          AND ${sources.platformSourceId} = ${platformSourceId}
      )`;
}

/** One Source with its Membership Count (`CONTEXT.md`), for the chip row. */
export interface SourceItemCount {
  platformSourceId: string;
  title: string;
  count: number;
}

/**
 * The platform's Sources that hold items, with their item counts — count
 * descending, then title. Sources without a link do not appear. Callers map
 * `platformSourceId` onto their own facet key (facet types stay per platform).
 */
export async function sourceItemCounts(
  db: FavbaseDb,
  platform: string,
): Promise<SourceItemCount[]> {
  return db
    .select({
      platformSourceId: sources.platformSourceId,
      title: sources.title,
      count: sql<number>`count(*)::int`,
    })
    .from(itemSources)
    .innerJoin(sources, eq(itemSources.sourceId, sources.id))
    .innerJoin(items, eq(itemSources.itemId, items.id))
    .where(eq(sources.platform, platform))
    .groupBy(sources.platformSourceId, sources.title)
    .orderBy(desc(sql`count(*)`), sources.title);
}

/**
 * Every `platformItemId` already stored for the platform. Takes anything that
 * can `select`, so `ingestCollection` passes its transaction (the
 * pre-existing diff) and the sync paths pass the db (incremental cutoff,
 * details-fill skip set, README diff).
 */
export async function platformItemIds(
  db: Pick<FavbaseDb, 'select'>,
  platform: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(eq(items.platform, platform));
  return new Set(rows.map((r) => r.platformItemId));
}
