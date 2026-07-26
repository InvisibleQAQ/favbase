import { asc, eq } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemContents } from '@/lib/database/entities/item-contents';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemTags } from '@/lib/database/entities/item-tags';
import { sources } from '@/lib/database/entities/sources';
import { tags } from '@/lib/database/entities/tags';

/** One exported note. Raw values — sanitizing belongs to the serializer. */
export interface ObsidianNote {
  id: string;
  platform: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  savedAt: Date;
  /** null when the item has no extracted content yet. */
  plainText: string | null;
  /** All collection titles, sorted; the first one owns the note's directory. */
  sources: string[];
  tags: string[];
}

/**
 * Side-table loads mirror `lib/collections/collections-query.ts`: separate
 * queries assembled into Maps rather than one wide join, which would multiply
 * item rows by (tags x sources).
 *
 * No `WHERE item_id IN (...)` because the export covers the whole table — that
 * also keeps us clear of the bind-parameter ceiling on large libraries.
 */
async function loadNamesByItem(
  db: FavbaseDb,
  kind: 'tags' | 'sources',
): Promise<Map<string, string[]>> {
  const rows =
    kind === 'tags'
      ? await db
          .select({ itemId: itemTags.itemId, name: tags.name })
          .from(itemTags)
          .innerJoin(tags, eq(tags.id, itemTags.tagId))
          .orderBy(asc(tags.name), asc(tags.id))
      : await db
          .select({ itemId: itemSources.itemId, name: sources.title })
          .from(itemSources)
          .innerJoin(sources, eq(sources.id, itemSources.sourceId))
          .orderBy(asc(sources.title), asc(sources.id));

  const byItem = new Map<string, string[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId);
    if (list) list.push(row.name);
    else byItem.set(row.itemId, [row.name]);
  }
  return byItem;
}

/**
 * Every row in `items`, newest last. The `(createdAt, id)` order is what makes
 * filename dedupe suffixes reproducible across repeated exports.
 *
 * Deliberately unfiltered by platform: an export that silently drops rows is
 * worse than one that emits an unexpected directory name.
 */
export async function queryObsidianNotes(db: FavbaseDb = getDb()): Promise<ObsidianNote[]> {
  const [rows, tagsByItem, sourcesByItem] = await Promise.all([
    db
      .select({
        id: items.id,
        platform: items.platform,
        title: items.title,
        authorName: items.authorName,
        originalUrl: items.originalUrl,
        publishedAt: items.publishedAt,
        savedAt: items.createdAt,
        plainText: itemContents.plainText,
      })
      .from(items)
      // LEFT JOIN: items with content_state pending/no_content/error have no row.
      .leftJoin(itemContents, eq(itemContents.itemId, items.id))
      .orderBy(asc(items.createdAt), asc(items.id)),
    loadNamesByItem(db, 'tags'),
    loadNamesByItem(db, 'sources'),
  ]);

  return rows.map((row) => ({
    ...row,
    sources: sourcesByItem.get(row.id) ?? [],
    tags: tagsByItem.get(row.id) ?? [],
  }));
}
