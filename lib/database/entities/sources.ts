import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(),
    platformSourceId: text('platform_source_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    platformMeta: jsonb('platform_meta').notNull().default({}),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uq_sources_platform').on(t.platform, t.platformSourceId)],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
