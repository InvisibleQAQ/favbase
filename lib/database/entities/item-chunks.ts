import { pgTable, uuid, text, integer, real, timestamp, index, unique, vector } from 'drizzle-orm/pg-core';
import { items } from './items';

export const itemChunks = pgTable(
  'item_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    chunkText: text('chunk_text').notNull(),
    // NOMINAL dimensions: drizzle requires the config, but it only feeds
    // drizzle-kit DDL generation (unused here — DDL lives in migrations/).
    // The REAL column dimension follows the active embedding model via runtime
    // ALTER (lib/embedding/vector-store.ts); read it from pg_attribute.atttypmod.
    embedding: vector('embedding', { dimensions: 1536 }),
    // Time span of subtitle-derived chunks (first row start / last row end).
    // NULL for non-timed content and rows created before migration v003.
    startSec: real('start_sec'),
    endSec: real('end_sec'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('uq_item_chunks_index').on(t.itemId, t.chunkIndex),
    index('idx_item_chunks_item_id').on(t.itemId),
    index('idx_item_chunks_text_trgm').using('gin', t.chunkText.op('gin_trgm_ops')),
  ],
);

export type ItemChunk = typeof itemChunks.$inferSelect;
export type NewItemChunk = typeof itemChunks.$inferInsert;
