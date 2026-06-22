import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { items } from './items';

export const itemContents = pgTable('item_contents', {
  itemId: uuid('item_id')
    .primaryKey()
    .references(() => items.id, { onDelete: 'cascade' }),
  plainText: text('plain_text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ItemContent = typeof itemContents.$inferSelect;
export type NewItemContent = typeof itemContents.$inferInsert;
