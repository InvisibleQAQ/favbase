import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemTags } from '@/lib/database/entities/item-tags';
import { tags } from '@/lib/database/entities/tags';
import type { TagRef, TaggedItem } from '@/lib/tagging';
import { escapeLike } from '@/lib/database/sql-utils';

export {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from './platforms';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from './platforms';

export interface CollectionItem extends Omit<TaggedItem, 'platform'> {
  platform: CollectionPlatform;
}

export interface CollectionItemsQuery {
  /** One platform chip; omitted/null means all registered platforms. */
  platform?: CollectionPlatform | null;
  /** Trimmed title/author search; omitted/blank means no search. */
  search?: string;
  /** 1-based page number. Values below 1 are normalized to 1. */
  page: number;
  /** Positive page size. Values below 1 are normalized to 1. */
  pageSize: number;
}

export interface CollectionItemsPage {
  rows: CollectionItem[];
  total: number;
}

/**
 * Platform-native chronological key used by the existing collection pages.
 * Bilibili and YouTube store their collection timestamps in JSON metadata;
 * bookmarks, X, and Zhihu already mirror their usable timestamp into
 * `items.publishedAt`. The regex guards prevent malformed optional metadata
 * from turning a read into a cast error. Rows without a usable native key are
 * ordered after dated rows and then by the insert timestamp below.
 */
const effectiveSortAt = sql<Date | null>`CASE
  WHEN ${items.platform} = 'bilibili'
    AND (${items.platformMeta}->>'fav_time') ~ '^[0-9]+(\\.[0-9]+)?$'
    THEN to_timestamp((${items.platformMeta}->>'fav_time')::double precision)
  WHEN ${items.platform} = 'github'
    AND (${items.platformMeta}->>'starredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    THEN ((${items.platformMeta}->>'starredAt')::timestamptz)
  WHEN ${items.platform} = 'youtube'
    AND (${items.platformMeta}->>'addedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    THEN ((${items.platformMeta}->>'addedAt')::timestamptz)
  WHEN ${items.platform} IN ('bookmarks', 'x', 'zhihu')
    THEN ${items.publishedAt}
  ELSE NULL
END`;

function normalizedPage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function normalizedPageSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function buildConditions({
  platform,
  search,
}: Pick<CollectionItemsQuery, 'platform' | 'search'>): SQL[] {
  const conditions: (SQL | undefined)[] = [inArray(items.platform, [...COLLECTION_PLATFORMS])];

  if (platform != null) conditions.push(eq(items.platform, platform));

  const normalizedSearch = search?.trim() ?? '';
  if (normalizedSearch) {
    const pattern = `%${escapeLike(normalizedSearch)}%`;
    conditions.push(or(ilike(items.title, pattern), ilike(items.authorName, pattern)));
  }

  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

async function loadTags(
  itemIds: string[],
  db: FavbaseDb,
): Promise<Map<string, TagRef[]>> {
  const tagsByItem = new Map<string, TagRef[]>();
  if (itemIds.length === 0) return tagsByItem;

  const rows = await db
    .select({ itemId: itemTags.itemId, id: tags.id, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(inArray(itemTags.itemId, itemIds))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const list = tagsByItem.get(row.itemId) ?? [];
    list.push({ id: row.id, name: row.name });
    tagsByItem.set(row.itemId, list);
  }

  return tagsByItem;
}

export async function getCollectionItems(
  query: CollectionItemsQuery,
  db: FavbaseDb = getDb(),
): Promise<CollectionItemsPage> {
  const conditions = buildConditions(query);
  const page = normalizedPage(query.page);
  const pageSize = normalizedPageSize(query.pageSize);
  const where = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        itemId: items.id,
        platform: items.platform,
        platformItemId: items.platformItemId,
        title: items.title,
        authorName: items.authorName,
        originalUrl: items.originalUrl,
        publishedAt: items.publishedAt,
        platformMeta: items.platformMeta,
      })
      .from(items)
      .where(where)
      .orderBy(sql`${effectiveSortAt} DESC NULLS LAST`, desc(items.createdAt), asc(items.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(items).where(where),
  ]);

  const tagsByItem = await loadTags(
    rows.map((row) => row.itemId),
    db,
  );

  return {
    rows: rows.map((row) => ({
      itemId: row.itemId,
      platform: row.platform as CollectionPlatform,
      platformItemId: row.platformItemId,
      title: row.title,
      authorName: row.authorName,
      originalUrl: row.originalUrl,
      publishedAt: row.publishedAt,
      platformMeta: row.platformMeta as Record<string, unknown>,
      tags: tagsByItem.get(row.itemId) ?? [],
    })),
    total: countRows[0]?.total ?? 0,
  };
}
