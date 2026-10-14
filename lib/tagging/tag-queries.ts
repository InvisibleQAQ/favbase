import { and, inArray, eq, sql, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';

import type { FavbaseDb } from '@/lib/database/db-types';
import { getDb } from '@/lib/database/db-state';
// Leaf, not the database barrel: this module is on the Background SW graph
// (the `listTags` Knowledge Tool), and so is everything it value-imports.
import { searchCondition } from '@/lib/database/collection-queries';
import { itemTags } from '@/lib/database/entities/item-tags';
import { items } from '@/lib/database/entities/items';
import { tags } from '@/lib/database/entities/tags';

export interface UsedTag {
  id: string;
  name: string;
  count: number;
}

/** One bounded page of used tags plus how many matched in all. */
export interface UsedTagPage {
  tags: UsedTag[];
  /** Tags matching the filters before `limit` cut them; 0 when none match. */
  total: number;
}

export interface UsedTagSearch {
  platform?: string;
  /** Case-insensitive substring of the tag name; blank = no name filter. */
  query?: string;
  limit: number;
}

function platformCondition(platform?: string | readonly string[]): SQL | undefined {
  const platforms = typeof platform === 'string' ? [platform] : platform;
  if (!platforms) return undefined;
  return platforms.length > 0 ? inArray(items.platform, [...platforms]) : sql<boolean>`false`;
}

/**
 * The one used-tag skeleton: inner joins hide orphan tags, the use count is
 * per tag within the WHERE scope, and the order (count desc, then the unique
 * name) breaks every tie, so a page cut by LIMIT is deterministic. `extra` adds
 * columns computed over the same grouped rows.
 */
function selectUsedTags<TExtra extends SelectedFields>(
  db: FavbaseDb,
  extra: TExtra,
  where: SQL | undefined,
) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${itemTags.itemId})::int`,
      ...extra,
    })
    .from(tags)
    .innerJoin(itemTags, eq(itemTags.tagId, tags.id))
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .where(where)
    .groupBy(tags.id, tags.name)
    .orderBy(sql`count(${itemTags.itemId}) desc`, tags.name);
}

/** Return non-orphan tags ordered by descending use count. */
export async function getAllUsedTags(
  platform?: string | readonly string[],
  db: FavbaseDb = getDb(),
): Promise<UsedTag[]> {
  return selectUsedTags(db, {}, platformCondition(platform));
}

/**
 * The first `limit` used tags, optionally scoped to a platform and filtered by
 * name, with the number that matched before the cut. `total` comes from the
 * same SELECT: the window runs after GROUP BY and before LIMIT.
 */
export async function searchUsedTags(
  { platform, query, limit }: UsedTagSearch,
  db: FavbaseDb = getDb(),
): Promise<UsedTagPage> {
  const rows = await selectUsedTags(
    db,
    { total: sql<number>`(count(*) over ())::int` },
    and(platformCondition(platform), searchCondition(query, [tags.name])),
  ).limit(limit);
  return {
    tags: rows.map(({ id, name, count }) => ({ id, name, count })),
    total: rows[0]?.total ?? 0,
  };
}
