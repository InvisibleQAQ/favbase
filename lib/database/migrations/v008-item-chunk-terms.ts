import type { PGlite } from '@electric-sql/pglite';
import { segmentWords, TEXT_SEARCH_CONFIG } from '../text-search';

/**
 * Chunks segmented and inserted per backfill statement. Large on purpose: on
 * an IndexedDB data dir every statement ends in a filesystem sync, and the
 * backfill has to finish inside the clients' 30 s `health` RPC timeout
 * (`bridges/proxy-driver.ts`). 20k chunks in Chrome: 6.9 s at 2000 per batch,
 * 11.9 s at 500.
 */
const BACKFILL_BATCH = 2000;

/**
 * v8: `item_chunk_terms`, the keyword index of `item_chunks` that the Chat
 * keyword arm searches (a GIN-indexed tsvector per chunk), and a one-time
 * backfill of every existing chunk.
 *
 * A side table, not a column on `item_chunks`: backfilling a column is an
 * UPDATE of every embedded row, which re-inserts each HNSW entry (4k chunks
 * measured: 7.8 s, against 1.0 s for this table). CASCADE drops the terms row
 * whenever `replaceItemChunks` deletes its chunk.
 *
 * The first migration that backfills (user approval 2026-10-13). Segmentation
 * runs in JS (`segmentWords`), because PGlite has no Chinese parser, so the
 * backfill cannot be a single SQL statement. It runs before the RPC handler is
 * released and blocks every DB request until done (20k chunks of ~400 chars
 * with 1024-dim vectors, `idb://` data dir in Chrome 155: 6.9 s including
 * the GIN build, plus 1.4 s to open the database).
 *
 * Idempotent and resumable: `IF NOT EXISTS`, and the backfill only reads
 * chunks without a terms row, walking `item_chunks` by id, so a run cut short
 * picks up where it stopped. The GIN index is built after the backfill, which
 * is cheaper than maintaining it row by row.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS item_chunk_terms (
      chunk_id UUID PRIMARY KEY REFERENCES item_chunks(id) ON DELETE CASCADE,
      tsv      TSVECTOR NOT NULL
    );
  `);
  await backfillChunkTerms(pg);
  await pg.exec(`
    CREATE INDEX IF NOT EXISTS idx_item_chunk_terms_tsv ON item_chunk_terms USING GIN (tsv);
  `);
}

interface UnindexedChunk {
  id: string;
  chunk_text: string;
}

async function backfillChunkTerms(pg: PGlite): Promise<void> {
  // Keyset walk: the id is the only progress marker, so the loop ends after
  // one pass whatever the inserts do.
  let afterId: string | null = null;
  for (;;) {
    const { rows }: { rows: UnindexedChunk[] } = await pg.query<UnindexedChunk>(
      `SELECT c.id, c.chunk_text
       FROM item_chunks c
       WHERE NOT EXISTS (SELECT 1 FROM item_chunk_terms t WHERE t.chunk_id = c.id)
         ${afterId === null ? '' : 'AND c.id > $2::uuid'}
       ORDER BY c.id
       LIMIT $1`,
      afterId === null ? [BACKFILL_BATCH] : [BACKFILL_BATCH, afterId],
    );
    if (rows.length === 0) return;

    await pg.query(
      `INSERT INTO item_chunk_terms (chunk_id, tsv)
       SELECT u.id, to_tsvector($1::regconfig, u.words)
       FROM unnest($2::uuid[], $3::text[]) AS u(id, words)
       ON CONFLICT (chunk_id) DO NOTHING`,
      [
        TEXT_SEARCH_CONFIG,
        rows.map((row) => row.id),
        rows.map((row) => segmentWords(row.chunk_text)),
      ],
    );
    afterId = rows[rows.length - 1].id;
  }
}
