import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { ingestCollection, persistExistingItemContent, settleItemContent } from './ingest';

describe('ingest module', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
  });

  afterAll(async () => {
    await pg.close();
  });

  async function seedItem(platformItemId: string) {
    const [author] = await db
      .insert(schema.authors)
      .values({
        platform: 'bilibili',
        platformAuthorId: `author-${platformItemId}`,
        name: 'UP',
      })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform: 'bilibili',
        platformItemId,
        authorId: author.id,
        title: 'Video',
        authorName: 'UP',
        originalUrl: `https://www.bilibili.com/video/${platformItemId}`,
        contentState: 'pending',
      })
      .returning();
    return item;
  }

  it('replaces prepared content and timestamped chunks on re-transcription', async () => {
    const item = await seedItem('BV-CONTENT');

    const result = await persistExistingItemContent(
      db,
      'bilibili',
      'BV-CONTENT',
      '  first line\nsecond line  ',
      [
        { text: 'first line', startSec: 1.25, endSec: 2.5 },
        { text: 'second line', startSec: 3, endSec: 4.75 },
      ],
      'official',
    );

    expect(result).toBe('chunked');
    await expect(
      db.select({ plainText: schema.itemContents.plainText }).from(schema.itemContents),
    ).resolves.toEqual([{ plainText: 'first line\nsecond line' }]);
    await expect(
      db
        .select({
          text: schema.itemChunks.chunkText,
          startSec: schema.itemChunks.startSec,
          endSec: schema.itemChunks.endSec,
        })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id))
        .orderBy(asc(schema.itemChunks.chunkIndex)),
    ).resolves.toEqual([
      { text: 'first line', startSec: 1.25, endSec: 2.5 },
      { text: 'second line', startSec: 3, endSec: 4.75 },
    ]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);

    await db
      .update(schema.items)
      .set({ contentState: 'embedded' })
      .where(eq(schema.items.id, item.id));
    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-CONTENT',
        'replacement line',
        [{ text: 'replacement line', startSec: 8, endSec: 9.5 }],
        'official',
      ),
    ).resolves.toBe('chunked');
    await expect(
      db
        .select({ plainText: schema.itemContents.plainText })
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toEqual([{ plainText: 'replacement line' }]);
    await expect(
      db
        .select({
          text: schema.itemChunks.chunkText,
          startSec: schema.itemChunks.startSec,
          endSec: schema.itemChunks.endSec,
        })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id)),
    ).resolves.toEqual([{ text: 'replacement line', startSec: 8, endSec: 9.5 }]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);
  });

  it('rolls an advanced state back to has_content when chunk replacement fails', async () => {
    const item = await seedItem('BV-CHUNK-FAIL');
    await db
      .update(schema.items)
      .set({ contentState: 'embedded' })
      .where(eq(schema.items.id, item.id));

    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-CHUNK-FAIL',
        'replacement that could not be chunked',
        [{ text: null as unknown as string, startSec: 0, endSec: 1 }],
        'official',
      ),
    ).rejects.toThrow();

    await expect(
      db
        .select({ plainText: schema.itemContents.plainText })
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toEqual([{ plainText: 'replacement that could not be chunked' }]);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'has_content' }]);
  });

  it('does not persist non-empty text without prepared chunks', async () => {
    const item = await seedItem('BV-NO-CHUNKS');

    const result = await persistExistingItemContent(
      db,
      'bilibili',
      'BV-NO-CHUNKS',
      'text without chunks',
      [],
      'official',
    );

    expect(result).toBeNull();
    await expect(
      db
        .select()
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'pending' }]);
  });

  it('returns null without writes when the platform item is missing', async () => {
    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-MISSING',
        'missing item content',
        [{ text: 'missing item content', startSec: 0, endSec: 1 }],
        'official',
      ),
    ).resolves.toBeNull();
  });

  it('leaves existing state and content untouched for blank text', async () => {
    const item = await seedItem('BV-BLANK');

    await expect(
      persistExistingItemContent(
        db,
        'bilibili',
        'BV-BLANK',
        '  \n  ',
        [{ text: 'should not be written', startSec: 0, endSec: 1 }],
        'official',
      ),
    ).resolves.toBeNull();
    await expect(
      db
        .select()
        .from(schema.itemContents)
        .where(eq(schema.itemContents.itemId, item.id)),
    ).resolves.toHaveLength(0);
    await expect(
      db
        .select({ state: schema.items.contentState })
        .from(schema.items)
        .where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'pending' }]);
  });

  // ---------------------------------------------------------------------------
  // Subtitle source (docs/29 Step 5): a transcript records how it was obtained,
  // and every write of plain_text also writes subtitle_source. Read with raw SQL
  // so the assertion sees the physical column the database export reads.
  // ---------------------------------------------------------------------------

  async function contentRowOf(itemId: string) {
    const { rows } = await pg.query<{ plain_text: string; subtitle_source: string | null }>(
      'SELECT plain_text, subtitle_source FROM item_contents WHERE item_id = $1',
      [itemId],
    );
    return rows;
  }

  it('records the subtitle source of a transcript', async () => {
    const item = await seedItem('BV-SOURCE-ASR');

    await persistExistingItemContent(
      db,
      'bilibili',
      'BV-SOURCE-ASR',
      'asr text',
      [{ text: 'asr text', startSec: 0, endSec: 1 }],
      'asr',
    );

    await expect(contentRowOf(item.id)).resolves.toEqual([
      { plain_text: 'asr text', subtitle_source: 'asr' },
    ]);
  });

  it('replaces the subtitle source together with the text on re-transcription', async () => {
    const item = await seedItem('BV-SOURCE-REPLACE');
    await persistExistingItemContent(
      db,
      'bilibili',
      'BV-SOURCE-REPLACE',
      'asr text',
      [{ text: 'asr text', startSec: 0, endSec: 1 }],
      'asr',
    );

    await persistExistingItemContent(
      db,
      'bilibili',
      'BV-SOURCE-REPLACE',
      'official text',
      [{ text: 'official text', startSec: 0, endSec: 1 }],
      'official',
    );

    await expect(contentRowOf(item.id)).resolves.toEqual([
      { plain_text: 'official text', subtitle_source: 'official' },
    ]);
  });

  it('stores NULL when the caller says the content is not a transcript', async () => {
    const item = await seedItem('BV-SOURCE-NULL');

    await persistExistingItemContent(
      db,
      'bilibili',
      'BV-SOURCE-NULL',
      'not a transcript',
      [{ text: 'not a transcript' }],
      null,
    );

    await expect(contentRowOf(item.id)).resolves.toEqual([
      { plain_text: 'not a transcript', subtitle_source: null },
    ]);
  });

  it('settleItemContent clears a subtitle source when it overwrites the text', async () => {
    const item = await seedItem('BV-SOURCE-OVERWRITE');
    await persistExistingItemContent(
      db,
      'bilibili',
      'BV-SOURCE-OVERWRITE',
      'asr text',
      [{ text: 'asr text', startSec: 0, endSec: 1 }],
      'asr',
    );

    await expect(
      settleItemContent(db, item.id, 'extracted text', (text) => [{ text }]),
    ).resolves.toBe(true);

    await expect(contentRowOf(item.id)).resolves.toEqual([
      { plain_text: 'extracted text', subtitle_source: null },
    ]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);
  });

  it('settleItemContent writes the chunker output and settles at chunked', async () => {
    const item = await seedItem('BV-SETTLE-TEXT');

    await expect(
      settleItemContent(db, item.id, '  one\ntwo  ', (text) =>
        text.split('\n').map((line) => ({ text: line })),
      ),
    ).resolves.toBe(true);

    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'chunked' }]);
    await expect(
      db
        .select({ text: schema.itemChunks.chunkText })
        .from(schema.itemChunks)
        .where(eq(schema.itemChunks.itemId, item.id))
        .orderBy(asc(schema.itemChunks.chunkIndex)),
    ).resolves.toEqual([{ text: 'one' }, { text: 'two' }]);
  });

  it('settleItemContent settles blank text at no_content without writing content', async () => {
    const item = await seedItem('BV-SETTLE-BLANK');

    await expect(
      settleItemContent(db, item.id, '  \n  ', (text) => [{ text }]),
    ).resolves.toBe(false);

    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, item.id)),
    ).resolves.toEqual([{ state: 'no_content' }]);
    await expect(contentRowOf(item.id)).resolves.toEqual([]);
  });

  it('rejects a subtitle source other than official or asr', async () => {
    const item = await seedItem('BV-SOURCE-CHECK');

    await expect(
      pg.query(
        `INSERT INTO item_contents (item_id, plain_text, subtitle_source) VALUES ($1, 'text', 'foo')`,
        [item.id],
      ),
    ).rejects.toThrow(/chk_subtitle_source/);
  });

  // ---------------------------------------------------------------------------
  // Ghost elimination: 'chunked' may only exist WITH chunk rows.
  // ---------------------------------------------------------------------------

  function collectionInput(
    platform: string,
    pids: string[],
    textOf: (pid: string) => string,
    chunk: (text: string) => { text: string }[] = (text) => [{ text }],
  ) {
    return {
      platform,
      sources: [{ platformSourceId: 'src', title: 'S' }],
      authors: pids.map((pid) => ({
        platformAuthorId: `a-${pid}`,
        name: 'A',
        avatarUrl: null,
      })),
      items: pids.map((pid) => ({
        platformItemId: pid,
        platformAuthorId: `a-${pid}`,
        title: pid,
        authorName: 'A',
        originalUrl: `https://example.com/${pid}`,
        publishedAt: null,
        contentState: 'chunked' as const,
        platformMeta: {},
      })),
      links: pids.map((pid) => ({ platformItemId: pid, platformSourceId: 'src' })),
      content: { textOf, chunk },
    };
  }

  async function stateOf(platform: string, pid: string) {
    const rows = await db
      .select({ id: schema.items.id, state: schema.items.contentState })
      .from(schema.items)
      .where(eq(schema.items.platformItemId, pid));
    return rows.find(Boolean)!;
  }

  async function chunkCountOf(itemId: string) {
    const rows = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, itemId));
    return rows.length;
  }

  it('an interrupted content phase never leaves chunked without chunk rows', async () => {
    const input = collectionInput(
      'ghost-order',
      ['ok-1', 'boom-2'],
      (pid) => `text of ${pid}`,
      (text) => {
        if (text.includes('boom-2')) throw new Error('chunker died mid-run');
        return [{ text }];
      },
    );

    await expect(ingestCollection(db, input)).rejects.toThrow('chunker died mid-run');

    // The completed item is truthfully 'chunked'; the interrupted one stays at
    // the 'has_content' interim — NEVER 'chunked' over zero chunk rows.
    const ok = await stateOf('ghost-order', 'ok-1');
    expect(ok.state).toBe('chunked');
    expect(await chunkCountOf(ok.id)).toBe(1);

    const interrupted = await stateOf('ghost-order', 'boom-2');
    expect(interrupted.state).toBe('has_content');
    expect(await chunkCountOf(interrupted.id)).toBe(0);
  });

  it('declared-chunked items with blank text settle at no_content, not a ghost', async () => {
    await ingestCollection(db, collectionInput('ghost-blank', ['blank-1'], () => '   '));

    const blank = await stateOf('ghost-blank', 'blank-1');
    expect(blank.state).toBe('no_content');
    expect(await chunkCountOf(blank.id)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Durable text (docs/33 D6): a new item's text is stored in the SAME
  // transaction as its row, so 'has_content' always means "the text is stored".
  // ---------------------------------------------------------------------------

  /** Any write matching `event` on `table` raises while `fn` runs; the trigger is dropped after. */
  async function whileForbidden<T>(table: string, event: string, fn: () => Promise<T>): Promise<T> {
    await pg.exec(`
      CREATE FUNCTION test_forbidden_write() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forbidden write'; END $$;
      CREATE TRIGGER test_forbidden_write
      ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_forbidden_write();
    `);
    try {
      return await fn();
    } finally {
      await pg.exec(`
        DROP TRIGGER test_forbidden_write ON ${table};
        DROP FUNCTION test_forbidden_write();
      `);
    }
  }

  it('an interrupted content phase leaves the items it never reached with their text stored, and the next call heals them without textOf', async () => {
    const input = collectionInput(
      'ghost-durable',
      ['ok-1', 'boom-2', 'unreached-3'],
      (pid) => `  text of ${pid}  `,
      (text) => {
        if (text.includes('boom-2')) throw new Error('chunker died mid-run');
        return [{ text }];
      },
    );
    await expect(ingestCollection(db, input)).rejects.toThrow('chunker died mid-run');

    // The item the content phase never got to: no chunks, but its (trimmed)
    // text went in with its row.
    const unreached = await stateOf('ghost-durable', 'unreached-3');
    expect(unreached.state).toBe('has_content');
    expect(await chunkCountOf(unreached.id)).toBe(0);
    await expect(contentRowOf(unreached.id)).resolves.toEqual([
      { plain_text: 'text of unreached-3', subtitle_source: null },
    ]);

    // The next call knows none of them (an incremental or page-sized sync):
    // both ghosts heal from the stored text instead of settling at no_content.
    const result = await ingestCollection(db, collectionInput('ghost-durable', [], () => ''));
    expect([...result.healedItemIds].sort()).toEqual(['boom-2', 'unreached-3']);
    expect([...result.contentPersisted].sort()).toEqual(['boom-2', 'unreached-3']);
    const healed = await stateOf('ghost-durable', 'unreached-3');
    expect(healed.state).toBe('chunked');
    expect(await chunkCountOf(healed.id)).toBe(1);
  });

  it('writes the text of a new item once: the content phase does not rewrite item_contents', async () => {
    const result = await whileForbidden('item_contents', 'BEFORE UPDATE', () =>
      ingestCollection(db, collectionInput('ghost-once', ['a', 'b'], (pid) => `text of ${pid}`)),
    );

    expect(result.contentPersisted).toEqual(['a', 'b']);
    const a = await stateOf('ghost-once', 'a');
    expect(a.state).toBe('chunked');
    await expect(contentRowOf(a.id)).resolves.toEqual([
      { plain_text: 'text of a', subtitle_source: null },
    ]);
  });

  it('a ghost healed from its stored text is re-chunked without rewriting item_contents', async () => {
    await ingestCollection(
      db,
      collectionInput('ghost-stored', ['stored-1'], () => 'stored text', () => {
        throw new Error('interrupt');
      }),
    ).catch(() => undefined);
    expect((await stateOf('ghost-stored', 'stored-1')).state).toBe('has_content');

    const result = await whileForbidden('item_contents', 'BEFORE UPDATE', () =>
      ingestCollection(db, collectionInput('ghost-stored', [], () => '')),
    );

    expect(result.healedItemIds).toEqual(['stored-1']);
    const healed = await stateOf('ghost-stored', 'stored-1');
    expect(healed.state).toBe('chunked');
    expect(await chunkCountOf(healed.id)).toBe(1);
  });

  it('a new declared-chunked item with blank text is inserted as no_content, with no interim state', async () => {
    // Any UPDATE of an items row raises: the row must be born 'no_content'.
    const result = await whileForbidden('items', 'BEFORE UPDATE', () =>
      ingestCollection(db, collectionInput('ghost-direct', ['born-blank'], () => ' \n ')),
    );

    expect(result.inserted.map((i) => i.platformItemId)).toEqual(['born-blank']);
    expect(result.contentPersisted).toEqual([]);
    const blank = await stateOf('ghost-direct', 'born-blank');
    expect(blank.state).toBe('no_content');
    await expect(contentRowOf(blank.id)).resolves.toEqual([]);
  });

  it('stores text for more new items than one content batch holds', async () => {
    const pids = Array.from({ length: 45 }, (_, i) => `batch-${i}`);
    const result = await ingestCollection(
      db,
      collectionInput('ghost-batch', pids, (pid) => `text of ${pid}`),
    );

    expect(result.contentPersisted).toEqual(pids);
    const { rows } = await pg.query<{ stored: number }>(
      `SELECT count(*)::int AS stored FROM item_contents c
       JOIN items i ON i.id = c.item_id WHERE i.platform = 'ghost-batch'`,
    );
    expect(rows[0].stored).toBe(45);
    const last = await stateOf('ghost-batch', 'batch-44');
    await expect(contentRowOf(last.id)).resolves.toEqual([
      { plain_text: 'text of batch-44', subtitle_source: null },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Storable text (docs/33 Step 2.5 复核): Postgres `text` cannot hold U+0000.
  // The module strips it wherever opaque text enters `item_contents`, BEFORE
  // any emptiness check, so one bad text can no longer fail a write — which,
  // with the text stored in the insert transaction, was the whole ingest.
  // ---------------------------------------------------------------------------

  async function chunkTextsOf(itemId: string) {
    const rows = await db
      .select({ text: schema.itemChunks.chunkText })
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, itemId))
      .orderBy(asc(schema.itemChunks.chunkIndex));
    return rows.map((row) => row.text);
  }

  it('NUL bytes in one new item\'s text do not roll the ingest back: they are stripped and every row lands', async () => {
    // A UTF-16 README decoded as UTF-8 looks like this.
    const result = await ingestCollection(
      db,
      collectionInput('nul-new', ['nul-before', 'nul-mid', 'nul-after'], (pid) =>
        pid === 'nul-mid' ? ' R\u0000E\u0000A\u0000D\u0000M\u0000E\u0000 ' : `text of ${pid}`,
      ),
    );

    expect(result.inserted.map((i) => i.platformItemId)).toEqual([
      'nul-before',
      'nul-mid',
      'nul-after',
    ]);
    expect(result.contentPersisted).toEqual(['nul-before', 'nul-mid', 'nul-after']);
    for (const pid of ['nul-before', 'nul-mid', 'nul-after']) {
      expect((await stateOf('nul-new', pid)).state).toBe('chunked');
    }
    const mid = await stateOf('nul-new', 'nul-mid');
    await expect(contentRowOf(mid.id)).resolves.toEqual([
      { plain_text: 'README', subtitle_source: null },
    ]);
    // The chunker only ever sees the normalised text.
    expect(await chunkTextsOf(mid.id)).toEqual(['README']);
  });

  it('a new declared-chunked item whose text is only NUL bytes is inserted as no_content', async () => {
    const result = await ingestCollection(
      db,
      collectionInput('nul-blank', ['nul-only'], () => '\u0000 \u0000'),
    );

    expect(result.inserted.map((i) => i.platformItemId)).toEqual(['nul-only']);
    expect(result.contentPersisted).toEqual([]);
    const item = await stateOf('nul-blank', 'nul-only');
    expect(item.state).toBe('no_content');
    await expect(contentRowOf(item.id)).resolves.toEqual([]);
  });

  it('settleItemContent strips NUL bytes before it stores and chunks, and before it decides the text is blank', async () => {
    const item = await seedItem('BV-SETTLE-NUL');
    const chunked: string[] = [];

    // NULs first, whitespace second: trimming first would leave the spaces
    // that the NULs were shielding.
    await expect(
      settleItemContent(db, item.id, '\u0000 extracted\u0000 text \u0000', (text) => {
        chunked.push(text);
        return [{ text }];
      }),
    ).resolves.toBe(true);

    expect(chunked).toEqual(['extracted text']);
    await expect(contentRowOf(item.id)).resolves.toEqual([
      { plain_text: 'extracted text', subtitle_source: null },
    ]);
    expect(await chunkTextsOf(item.id)).toEqual(['extracted text']);

    // Nothing but NULs is blank text: no content row, 'no_content'.
    const blank = await seedItem('BV-SETTLE-NUL-ONLY');
    await expect(
      settleItemContent(db, blank.id, '\u0000\u0000', (text) => [{ text }]),
    ).resolves.toBe(false);
    await expect(contentRowOf(blank.id)).resolves.toEqual([]);
    await expect(
      db.select({ state: schema.items.contentState }).from(schema.items).where(eq(schema.items.id, blank.id)),
    ).resolves.toEqual([{ state: 'no_content' }]);
  });

  it('a ghost whose text from this call is only NUL bytes heals from its stored text', async () => {
    await ingestCollection(
      db,
      collectionInput('nul-sweep', ['nul-ghost'], () => 'stored text', () => {
        throw new Error('interrupt');
      }),
    ).catch(() => undefined);
    expect((await stateOf('nul-sweep', 'nul-ghost')).state).toBe('has_content');

    // This call's textOf has "text" for the ghost, but none of it is storable:
    // that is blank, so the sweep must fall through to the stored plainText
    // instead of settling the ghost at no_content.
    const result = await ingestCollection(
      db,
      collectionInput('nul-sweep', [], () => '\u0000\u0000'),
    );

    expect(result.healedItemIds).toEqual(['nul-ghost']);
    expect(result.contentPersisted).toEqual(['nul-ghost']);
    const healed = await stateOf('nul-sweep', 'nul-ghost');
    expect(healed.state).toBe('chunked');
    await expect(contentRowOf(healed.id)).resolves.toEqual([
      { plain_text: 'stored text', subtitle_source: null },
    ]);
    expect(await chunkTextsOf(healed.id)).toEqual(['stored text']);
  });

  it('ghost sweep heals from textOf, then plainText, else settles no_content', async () => {
    // Round 1: interrupt after the first item. 'from-text' completes,
    // 'from-plaintext' dies chunking with its text stored, 'hopeless' is blank.
    let calls = 0;
    await ingestCollection(
      db,
      collectionInput(
        'ghost-heal',
        ['from-text', 'from-plaintext', 'hopeless'],
        (pid) => (pid === 'hopeless' ? '' : `original ${pid}`),
        (text) => {
          calls += 1;
          if (calls >= 2) throw new Error('interrupt');
          return [{ text }];
        },
      ),
    ).catch(() => undefined);

    // Manufacture the classic pre-fix ghost shapes: every row claims 'chunked'
    // ('hopeless' never had text anywhere), and 'from-text' loses both its
    // chunks and its stored text — a ghost from before text was written with
    // the row, which only a fresh textOf can heal.
    await db
      .update(schema.items)
      .set({ contentState: 'chunked' })
      .where(eq(schema.items.platform, 'ghost-heal'));
    const preFrom = await stateOf('ghost-heal', 'from-text');
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, preFrom.id));
    await db.delete(schema.itemContents).where(eq(schema.itemContents.itemId, preFrom.id));

    // Round 2: a fresh sync provides text for 'from-text' only. 'from-plaintext'
    // heals from its persisted item_contents; 'hopeless' has no text anywhere.
    const result = await ingestCollection(
      db,
      collectionInput('ghost-heal', [], (pid) =>
        pid === 'from-text' ? 'refetched text' : '',
      ),
    );

    expect([...result.contentPersisted].sort()).toEqual(['from-plaintext', 'from-text']);
    expect([...result.healedItemIds].sort()).toEqual(['from-plaintext', 'from-text']);

    const fromText = await stateOf('ghost-heal', 'from-text');
    expect(fromText.state).toBe('chunked');
    expect(await chunkCountOf(fromText.id)).toBe(1);

    const fromPlain = await stateOf('ghost-heal', 'from-plaintext');
    expect(fromPlain.state).toBe('chunked');
    expect(await chunkCountOf(fromPlain.id)).toBe(1);

    const hopeless = await stateOf('ghost-heal', 'hopeless');
    expect(hopeless.state).toBe('no_content');
    expect(await chunkCountOf(hopeless.id)).toBe(0);
  });

  it('the ghost sweep leaves healthy items and other platforms alone', async () => {
    // Healthy: chunked WITH chunks on the swept platform.
    await ingestCollection(
      db,
      collectionInput('ghost-scope', ['healthy'], () => 'healthy text'),
    );
    // Ghost on ANOTHER platform must not be swept by this platform's sync.
    await ingestCollection(
      db,
      collectionInput('ghost-scope-other', ['foreign'], () => 'foreign text'),
    );
    const foreign = await stateOf('ghost-scope-other', 'foreign');
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, foreign.id));

    const result = await ingestCollection(
      db,
      collectionInput('ghost-scope', [], () => ''),
    );

    expect(result.contentPersisted).toEqual([]);
    expect(result.healedItemIds).toEqual([]);
    const healthy = await stateOf('ghost-scope', 'healthy');
    expect(healthy.state).toBe('chunked');
    // The foreign ghost is untouched (still lying) — its own platform's next
    // sync heals it.
    expect((await stateOf('ghost-scope-other', 'foreign')).state).toBe('chunked');
  });

  it('upserts sources when collection ingest has no items', async () => {
    const baseInput = {
      platform: 'bilibili',
      authors: [],
      items: [],
      links: [],
    };

    await ingestCollection(db, {
      ...baseInput,
      sources: [
        { platformSourceId: 'folder-source-only', title: 'Old title', platformMeta: { count: 1 } },
      ],
    });
    await ingestCollection(db, {
      ...baseInput,
      sources: [
        { platformSourceId: 'folder-source-only', title: 'New title', platformMeta: { count: 2 } },
      ],
    });

    await expect(
      db
        .select({ title: schema.sources.title, meta: schema.sources.platformMeta })
        .from(schema.sources)
        .where(eq(schema.sources.platformSourceId, 'folder-source-only')),
    ).resolves.toEqual([{ title: 'New title', meta: { count: 2 } }]);
  });
});
