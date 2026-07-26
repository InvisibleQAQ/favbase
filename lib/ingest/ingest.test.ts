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
import { ingestCollection, persistExistingItemContent } from './ingest';

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

  it('ghost sweep heals from textOf, then plainText, else settles no_content', async () => {
    // Round 1: three ghosts by construction — interrupt after the first item.
    let calls = 0;
    await ingestCollection(
      db,
      collectionInput(
        'ghost-heal',
        ['from-text', 'from-plaintext', 'hopeless'],
        (pid) => (pid === 'hopeless' ? '' : `original ${pid}`),
        (text) => {
          // Let 'from-plaintext' persist its item_contents then die chunking;
          // 'from-text' dies before any content write (textOf consumed later).
          calls += 1;
          if (calls >= 2) throw new Error('interrupt');
          return [{ text }];
        },
      ),
    ).catch(() => undefined);

    // Manufacture the classic pre-fix ghost shape: claim 'chunked', drop chunks.
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
