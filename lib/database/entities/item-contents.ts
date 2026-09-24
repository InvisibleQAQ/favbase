import { pgTable, uuid, text, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SubtitleSource } from '@/lib/subtitle/types';
import { items } from './items';

export const itemContents = pgTable(
  'item_contents',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => items.id, { onDelete: 'cascade' }),
    plainText: text('plain_text').notNull(),
    /**
     * How a transcript was obtained (v006, docs/29 Step 5). NULL = not a
     * transcript, or a Bilibili row written before v006. Written together with
     * `plainText` on every write (lib/ingest/ingest.ts). Not the collection's
     * Source (folder / playlist containers).
     */
    subtitleSource: text('subtitle_source').$type<SubtitleSource>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check('chk_subtitle_source', sql`${t.subtitleSource} IN ('official','asr')`)],
);

export type ItemContent = typeof itemContents.$inferSelect;
export type NewItemContent = typeof itemContents.$inferInsert;
