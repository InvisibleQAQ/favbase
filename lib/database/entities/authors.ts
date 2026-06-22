import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';

export const authors = pgTable(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(),
    platformAuthorId: text('platform_author_id').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    platformMeta: jsonb('platform_meta').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uq_authors_platform').on(t.platform, t.platformAuthorId)],
);

export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;
