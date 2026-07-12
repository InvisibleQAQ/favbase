import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { items } from './items';
import { tags } from './tags';

export const itemTags = pgTable(
  'item_tags',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tagId] }),
    index('idx_item_tags_tag_id').on(t.tagId),
  ],
);

export type ItemTag = typeof itemTags.$inferSelect;
export type NewItemTag = typeof itemTags.$inferInsert;
