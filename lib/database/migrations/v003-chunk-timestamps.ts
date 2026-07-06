import type { PGlite } from '@electric-sql/pglite';

/**
 * v3: nullable start_sec / end_sec on item_chunks.
 *
 * Subtitle-derived chunks keep their time span (first row start / last row end)
 * so retrieval can later jump to the video timestamp. Timestamps live ONLY in
 * these columns — they are never mixed into chunk_text (would pollute the
 * embedding). Non-timed content (future article platforms) leaves them NULL,
 * as do rows created before this migration.
 *
 * `IF NOT EXISTS` keeps this idempotent under the `_migrations`-tracked runner.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    ALTER TABLE item_chunks ADD COLUMN IF NOT EXISTS start_sec REAL;
    ALTER TABLE item_chunks ADD COLUMN IF NOT EXISTS end_sec REAL;
  `);
}
