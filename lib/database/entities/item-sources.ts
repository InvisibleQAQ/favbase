import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { items } from './items';
import { sources } from './sources';

export const itemSources = pgTable(
  'item_sources',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.sourceId] }),
    index('idx_item_sources_source_id').on(t.sourceId),
  ],
);

export type ItemSource = typeof itemSources.$inferSelect;
export type NewItemSource = typeof itemSources.$inferInsert;
