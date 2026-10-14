import { pgTable, uuid, customType, index } from 'drizzle-orm/pg-core';
import { itemChunks } from './item-chunks';

/** Postgres `tsvector`, read and written as its text form. */
const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/**
 * Keyword index of `item_chunks`: one row per chunk, holding the tsvector of
 * its word-segmented text. A side table rather than a column, so writing or
 * backfilling it never rewrites `item_chunks` rows (and their HNSW entries).
 */
export const itemChunkTerms = pgTable(
  'item_chunk_terms',
  {
    chunkId: uuid('chunk_id')
      .primaryKey()
      .references(() => itemChunks.id, { onDelete: 'cascade' }),
    tsv: tsvector('tsv').notNull(),
  },
  (t) => [index('idx_item_chunk_terms_tsv').using('gin', t.tsv)],
);

export type ItemChunkTerm = typeof itemChunkTerms.$inferSelect;
export type NewItemChunkTerm = typeof itemChunkTerms.$inferInsert;
