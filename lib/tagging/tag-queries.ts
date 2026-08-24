import { inArray, eq, sql } from 'drizzle-orm';

import type { FavbaseDb } from '@/lib/database/db-types';
import { getDb } from '@/lib/database/db-state';
import { itemTags } from '@/lib/database/entities/item-tags';
import { items } from '@/lib/database/entities/items';
import { tags } from '@/lib/database/entities/tags';

export interface UsedTag {
  id: string;
  name: string;
  count: number;
}

/** Return non-orphan tags ordered by descending use count. */
export async function getAllUsedTags(
  platform?: string | readonly string[],
  db: FavbaseDb = getDb(),
): Promise<UsedTag[]> {
  const platforms = typeof platform === 'string' ? [platform] : platform;
  const platformCondition = platforms
    ? platforms.length > 0
      ? inArray(items.platform, [...platforms])
      : sql<boolean>`false`
    : undefined;
  return db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${itemTags.itemId})::int`,
    })
    .from(tags)
    .innerJoin(itemTags, eq(itemTags.tagId, tags.id))
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .where(platformCondition)
    .groupBy(tags.id, tags.name)
    .orderBy(sql`count(${itemTags.itemId}) desc`, tags.name);
}
