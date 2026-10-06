/**
 * Test support only — no runtime module imports this file. It lives in
 * `tests/` (like tests/platform-env-guard-contract.ts) rather than beside
 * lib/ingest/ingest.ts, so nothing under `lib/` is test-only without saying
 * so in its file name.
 *
 * Cuts the content phase of `ingestCollection` short the way a closed page or
 * a failed write does, for callers that cannot inject a chunker (x / youtube /
 * douyin run the shared pipeline behind their own sync entry). Same idiom as
 * the scoped triggers in lib/bookmarks/bookmark-content-service.test.ts.
 */

import type { PGlite } from '@electric-sql/pglite';

/** Put this at the START of an item's text to make its chunk insert fail. */
export const CUT_SHORT_MARKER = 'CUT-SHORT';

/**
 * Run `fn` while the chunk insert of any text starting with
 * `CUT_SHORT_MARKER` raises. The content phase walks items in input order, so
 * the marked item keeps whatever was written before its chunk insert and every
 * item AFTER it is never reached — those are the ones an interrupted run used
 * to leave without stored text. The trigger is dropped before this returns
 * (the test files share one PGlite across their cases).
 */
export async function withChunkWritesCutShort<T>(pg: PGlite, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`
    CREATE FUNCTION test_cut_short_chunks() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.chunk_text LIKE '${CUT_SHORT_MARKER}%' THEN
        RAISE EXCEPTION 'content phase cut short';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_cut_short_chunks
    BEFORE INSERT ON item_chunks
    FOR EACH ROW EXECUTE FUNCTION test_cut_short_chunks();
  `);
  try {
    return await fn();
  } finally {
    await pg.exec(`
      DROP TRIGGER test_cut_short_chunks ON item_chunks;
      DROP FUNCTION test_cut_short_chunks();
    `);
  }
}
