import { pgTable, uuid, text, jsonb, timestamp, index, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { authors } from './authors';

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(),
    platformItemId: text('platform_item_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    authorName: text('author_name').notNull(),
    originalUrl: text('original_url').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    contentState: text('content_state').notNull().default('pending'),
    platformMeta: jsonb('platform_meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('uq_items_platform').on(t.platform, t.platformItemId),
    index('idx_items_author_id').on(t.authorId),
    index('idx_items_created_at').on(t.createdAt.desc()),
    index('idx_items_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    check(
      'chk_content_state',
      sql`${t.contentState} IN ('pending','has_content','chunked','embedded','no_content','error')`,
    ),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
