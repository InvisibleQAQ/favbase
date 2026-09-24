import type { PGlite } from '@electric-sql/pglite';

/**
 * v6: nullable subtitle_source on item_contents (docs/29 Step 5, defect C6).
 *
 * How a transcript was obtained: the platform's own subtitle ('official') or
 * favbase's speech recognition ('asr') — `SubtitleSource` in
 * lib/subtitle/types.ts. Only transcript text carries a value. NULL means the
 * content is not a transcript (the five other platforms' text, whose origin
 * the platform already implies), or a Bilibili row written before this
 * migration — no backfill, the extension has not shipped yet.
 *
 * Not the collection's Source (folder / playlist containers, CONTEXT.md).
 *
 * The named CHECK lets NULL through, which is exactly "not a transcript".
 * `IF NOT EXISTS` keeps this idempotent under the `_migrations`-tracked
 * runner; when the column already exists the constraint is skipped with it.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    ALTER TABLE item_contents ADD COLUMN IF NOT EXISTS subtitle_source TEXT
      CONSTRAINT chk_subtitle_source CHECK (subtitle_source IN ('official','asr'));
  `);
}
