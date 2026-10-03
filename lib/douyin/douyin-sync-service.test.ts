import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';

// No storage mock: the service's load graph is storage-free by contract
// (tests/lib-import-smoke.test.ts covers lib/douyin once the discriminator
// flips in docs/33 Step 2). The pacer is injected as a no-op, so nothing here
// waits; retries are covered with fake timers in douyin-api.test.ts.
import {
  DouyinRateLimitError,
  DouyinStatusError,
  getDouyinItems,
  getFolderCounts,
  syncDouyinCollectionsToDb,
  type DouyinBackfillState,
  type DouyinPacer,
  type DouyinRequest,
  type DouyinTransport,
  type DouyinTransportResult,
  type SyncDouyinOptions,
} from './douyin-sync-service';

const PLATFORM = 'douyin';
const LIST = '/aweme/v1/web/aweme/listcollection/';
const FOLDERS = '/aweme/v1/web/collects/list/';
const FOLDER_ITEMS = '/aweme/v1/web/collects/video/list/';
const TOP = 1789911201230543;
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

// ---------------------------------------------------------------------------
// A fake www.douyin.com: three endpoints with the cursor semantics measured in
// the 2026-10-03 live probe (listcollection: descending 16-digit µs cursor,
// has_more 0/1; collects/list: offset cursor, has_more bool, `collects_list:
// null` when the user has no folder; collects/video/list: offset, has_more 0/1).
// ---------------------------------------------------------------------------

function rawAweme(id: string, overrides: Record<string, unknown> = {}) {
  return {
    aweme_id: id,
    desc: `desc ${id}`,
    create_time: 1_700_000_000 + Number(id.replace(/\D/g, '') || 0),
    author: {
      sec_uid: 'MS4wLjABAAAA_alice',
      nickname: 'Alice',
      avatar_thumb: { url_list: ['https://p3/avatar.jpeg'] },
    },
    video: { duration: 12_000, cover: { url_list: ['https://p3/cover.jpeg'] } },
    images: null,
    ...overrides,
  };
}

interface Fav {
  raw: Record<string, unknown>;
  /** The listcollection cursor value of this favorite (µs timestamp, newest first). */
  ts: number;
}

function favs(ids: string[], top = TOP): Fav[] {
  return ids.map((id, i) => ({ raw: rawAweme(id), ts: top - i * 1000 }));
}

interface FakeFolder {
  id: string;
  name: string;
  status: number;
  items: Record<string, unknown>[];
}

interface World {
  favorites: Fav[];
  folders?: FakeFolder[];
  pageSize?: number;
  intercept?: (req: DouyinRequest) => DouyinTransportResult | undefined;
}

function ok(body: unknown): DouyinTransportResult {
  return { kind: 'response', status: 200, text: JSON.stringify(body) };
}

function fakeDouyin(world: World) {
  const requests: DouyinRequest[] = [];
  const transport: DouyinTransport = async (req) => {
    requests.push(req);
    const hit = world.intercept?.(req);
    if (hit) return hit;
    const size = world.pageSize ?? 2;

    if (req.path === LIST) {
      const cursor = req.form?.cursor ?? '0';
      const rest =
        cursor === '0' ? world.favorites : world.favorites.filter((f) => f.ts < Number(cursor));
      const page = rest.slice(0, size);
      return ok({
        status_code: 0,
        aweme_list: page.map((f) => f.raw),
        cursor: page.length > 0 ? page[page.length - 1].ts : 0,
        has_more: rest.length > size ? 1 : 0,
        invalid_item_count: 0,
      });
    }
    if (req.path === FOLDERS) {
      const all = world.folders ?? [];
      const offset = Number(req.query.cursor);
      const page = all.slice(offset, offset + size);
      return ok({
        status_code: 0,
        collects_list:
          all.length === 0
            ? null
            : page.map((f) => ({
                collects_id: 6910000000000000000,
                collects_id_str: f.id,
                collects_name: f.name,
                status: f.status,
                states: 1,
                total_number: f.items.length,
              })),
        cursor: offset + page.length,
        has_more: offset + size < all.length,
        total_number: all.length,
      });
    }
    if (req.path === FOLDER_ITEMS) {
      const folder = (world.folders ?? []).find((f) => f.id === req.query.collects_id);
      const all = folder?.items ?? [];
      const offset = Number(req.query.cursor);
      const page = all.slice(offset, offset + size);
      return ok({
        status_code: 0,
        aweme_list: page,
        cursor: offset + page.length,
        has_more: offset + size < all.length ? 1 : 0,
        sec_uid: '',
      });
    }
    throw new Error(`unexpected path ${req.path}`);
  };
  return { transport, requests };
}

function listCursors(requests: DouyinRequest[]): string[] {
  return requests.filter((r) => r.path === LIST).map((r) => r.form?.cursor ?? '');
}

const noPacer: DouyinPacer = { beforeRequest: async () => {} };

const FRESH: DouyinBackfillState = { resumeCursor: null, backfillDone: false };
const DONE: DouyinBackfillState = { resumeCursor: null, backfillDone: true };

describe('douyin-sync-service (in-memory PGlite)', () => {
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

  afterEach(async () => {
    await db.delete(schema.itemChunks);
    await db.delete(schema.itemContents);
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.authors);
    await db.delete(schema.sources);
  });

  /** Run one sync; returns the result (or the thrown error) plus every backfill write. */
  async function run(
    transport: DouyinTransport,
    backfill: DouyinBackfillState,
    extra: Partial<SyncDouyinOptions> = {},
  ) {
    const states: DouyinBackfillState[] = [];
    const persisted: string[][] = [];
    const outcome = await syncDouyinCollectionsToDb(db, transport, {
      backfill,
      onBackfill: (state) => {
        states.push({ ...state });
      },
      onPagePersisted: (ids) => {
        persisted.push([...ids]);
      },
      pacer: noPacer,
      now: () => NOW,
      ...extra,
    }).then(
      (result) => ({ result, error: null as unknown }),
      (error: unknown) => ({ result: null, error }),
    );
    return { ...outcome, states, persisted, last: states.at(-1) ?? backfill };
  }

  async function storedIds(): Promise<string[]> {
    const rows = await db
      .select({ id: schema.items.platformItemId })
      .from(schema.items)
      .where(eq(schema.items.platform, PLATFORM));
    return rows.map((r) => r.id).sort();
  }

  async function getItem(platformItemId: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.platform, PLATFORM), eq(schema.items.platformItemId, platformItemId)),
      );
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // First full sync
  // -------------------------------------------------------------------------

  it('first sync walks every page, writes the cursor after each one and ends the backfill', async () => {
    const world: World = { favorites: favs(['1', '2', '3', '4', '5']) };
    const { transport, requests } = fakeDouyin(world);

    const { result, error, states } = await run(transport, FRESH);

    expect(error).toBeNull();
    expect(listCursors(requests)).toEqual(['0', String(TOP - 1000), String(TOP - 3000)]);
    expect(states).toEqual([
      { resumeCursor: String(TOP - 1000), backfillDone: false },
      { resumeCursor: String(TOP - 3000), backfillDone: false },
      DONE,
    ]);
    expect(await storedIds()).toEqual(['1', '2', '3', '4', '5']);
    expect(result).toMatchObject({ fetched: 5, inserted: 5, folders: 0 });
    expect(result?.newItemIds.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('D-a: items from the all-favorites list carry no Source, and are still queryable', async () => {
    const { transport } = fakeDouyin({ favorites: favs(['1', '2']) });
    await run(transport, FRESH);

    expect(await db.select().from(schema.itemSources)).toEqual([]);
    expect(await db.select().from(schema.sources)).toEqual([]);
    const { rows, total } = await getDouyinItems({ page: 1, pageSize: 10 }, db);
    expect(total).toBe(2);
    expect(rows.map((r) => r.awemeId).sort()).toEqual(['1', '2']);
    expect(await getFolderCounts(db)).toEqual([]);
  });

  it('D-b: onPagePersisted fires per page with the ids whose content landed', async () => {
    const list = favs(['1', '2', '3']);
    list[1].raw = rawAweme('2', { desc: '' });
    const { transport } = fakeDouyin({ favorites: list });

    const { persisted } = await run(transport, FRESH);

    // Page 1 = [1, 2]: '2' has no desc → no content → not dispatched. Page 2 = [3].
    expect(persisted).toEqual([['1'], ['3']]);
  });

  it('reports the cumulative fetched count per page', async () => {
    const { transport } = fakeDouyin({ favorites: favs(['1', '2', '3']) });
    const onProgress = vi.fn();
    await run(transport, FRESH, { onProgress });
    expect(onProgress.mock.calls).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  // -------------------------------------------------------------------------
  // Row mapping (docs/33 §4.3)
  // -------------------------------------------------------------------------

  it('maps title, URL, author, publishedAt, content state and platform_meta', async () => {
    const longDesc = `${'长'.repeat(200)}\nsecond line`;
    const list: Fav[] = [
      { raw: rawAweme('11', { desc: '\n\n   first line  \nsecond line #tag' }), ts: TOP },
      {
        raw: rawAweme('12', {
          images: [{ url_list: ['https://p3/img.webp'] }],
          video: { duration: 0, cover: { url_list: [] } },
        }),
        ts: TOP - 1000,
      },
      { raw: rawAweme('13', { desc: '' }), ts: TOP - 2000 },
      { raw: rawAweme('14', { desc: longDesc }), ts: TOP - 3000 },
    ];
    const { transport } = fakeDouyin({ favorites: list, pageSize: 10 });
    await run(transport, FRESH);

    const first = await getItem('11');
    expect(first.title).toBe('first line');
    expect(first.originalUrl).toBe('https://www.douyin.com/video/11');
    expect(first.authorName).toBe('Alice');
    expect(first.publishedAt?.getTime()).toBe((1_700_000_000 + 11) * 1000);
    expect(first.contentState).toBe('chunked');
    expect(first.platformMeta).toEqual({
      desc: '\n\n   first line  \nsecond line #tag',
      authorName: 'Alice',
      authorSecUid: 'MS4wLjABAAAA_alice',
      avatarUrl: 'https://p3/avatar.jpeg',
      coverUrl: 'https://p3/cover.jpeg',
      durationMs: 12_000,
      mediaKind: 'video',
      folderId: null,
      folderTitle: null,
    });

    const note = await getItem('12');
    expect(note.originalUrl).toBe('https://www.douyin.com/note/12');
    expect(note.platformMeta).toMatchObject({ mediaKind: 'note', durationMs: null, coverUrl: 'https://p3/img.webp' });

    const empty = await getItem('13');
    expect(empty.title).toBe('Alice');
    expect(empty.contentState).toBe('no_content');
    const emptyContent = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, empty.id));
    expect(emptyContent).toEqual([]);

    const long = await getItem('14');
    expect(long.title).toBe('长'.repeat(140));

    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, first.id));
    expect(chunks.length).toBeGreaterThan(0);

    const [author] = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, PLATFORM));
    expect(author).toMatchObject({ platformAuthorId: 'MS4wLjABAAAA_alice', name: 'Alice' });
  });

  it('F: an aweme whose author has no sec_uid is dropped, the rest of the page lands', async () => {
    const list = favs(['1', '2']);
    list[0].raw = rawAweme('1', { author: { sec_uid: '', nickname: 'Ghost' } });
    const { transport } = fakeDouyin({ favorites: list });
    await run(transport, FRESH);
    expect(await storedIds()).toEqual(['2']);
  });

  // -------------------------------------------------------------------------
  // Folders (D1): public → Source, private → not, membership through links
  // -------------------------------------------------------------------------

  it('public folders become Sources (an empty one too); private ones do not; folder items get links', async () => {
    const world: World = {
      favorites: favs(['1', '2']),
      folders: [
        { id: '6910000000000000202', name: 'Public', status: 1, items: [rawAweme('1'), rawAweme('99')] },
        { id: '6910000000000000201', name: 'Private', status: 0, items: [rawAweme('2')] },
        { id: '6910000000000000203', name: 'Empty public', status: 1, items: [] },
      ],
      pageSize: 10,
    };
    const { transport, requests } = fakeDouyin(world);

    const { result } = await run(transport, FRESH);

    const sourceRows = await db
      .select({ id: schema.sources.platformSourceId, title: schema.sources.title })
      .from(schema.sources)
      .where(eq(schema.sources.platform, PLATFORM));
    expect(sourceRows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: '6910000000000000202', title: 'Public' },
      { id: '6910000000000000203', title: 'Empty public' },
    ]);
    expect(result?.folders).toBe(2);
    expect(
      requests.filter((r) => r.path === FOLDER_ITEMS).map((r) => r.query.collects_id),
    ).toEqual(['6910000000000000202', '6910000000000000203']);

    // In the folder only, never in the list fetched so far — still a Collection Item.
    expect(await storedIds()).toEqual(['1', '2', '99']);
    expect((await getItem('99')).platformMeta).toMatchObject({
      folderId: '6910000000000000202',
      folderTitle: 'Public',
    });
    // First seen through the all-favorites list → no folder in the display meta.
    expect((await getItem('1')).platformMeta).toMatchObject({ folderId: null, folderTitle: null });

    expect(await getFolderCounts(db)).toEqual([
      { folderId: '6910000000000000202', title: 'Public', count: 2 },
    ]);
    const inFolder = await getDouyinItems(
      { folderId: '6910000000000000202', page: 1, pageSize: 10 },
      db,
    );
    expect(inFolder.rows.map((r) => r.awemeId).sort()).toEqual(['1', '99']);
    expect(inFolder.rows.find((r) => r.awemeId === '99')?.folderTitle).toBe('Public');
  });

  // -------------------------------------------------------------------------
  // Incremental head segment
  // -------------------------------------------------------------------------

  it('incremental: stops at the first page whose every item is already stored', async () => {
    const world: World = { favorites: favs(['1', '2', '3', '4', '5']) };
    await run(fakeDouyin(world).transport, FRESH);

    // Nothing new: one listcollection page.
    const quiet = fakeDouyin(world);
    const again = await run(quiet.transport, DONE);
    expect(again.error).toBeNull();
    expect(listCursors(quiet.requests)).toEqual(['0']);
    expect(again.states).toEqual([]);

    // One new favorite on top: page 1 = [new, 1] is partly new, page 2 = [2, 3] is known.
    world.favorites = [{ raw: rawAweme('6'), ts: TOP + 5000 }, ...world.favorites];
    const next = fakeDouyin(world);
    const incremental = await run(next.transport, DONE);
    expect(listCursors(next.requests)).toEqual(['0', String(TOP)]);
    expect(incremental.result).toMatchObject({ inserted: 1 });
    expect(await storedIds()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('a re-favorited old video on top does not hide the new favorite below it', async () => {
    const world: World = { favorites: favs(['1', '2', '3', '4']) };
    await run(fakeDouyin(world).transport, FRESH);

    // '3' re-favorited (moves to the top), '7' new right under it.
    world.favorites = [
      { raw: rawAweme('3'), ts: TOP + 9000 },
      { raw: rawAweme('7'), ts: TOP + 8000 },
      ...favs(['1', '2', '4']),
    ];
    const { transport } = fakeDouyin(world);
    await run(transport, DONE);
    expect(await storedIds()).toContain('7');
  });

  // -------------------------------------------------------------------------
  // Breakpoint state machine (docs/33 Step 1 rule 6, as amended by design B)
  // -------------------------------------------------------------------------

  const SIX = ['1', '2', '3', '4', '5', '6'];
  const PAGE3 = String(TOP - 3000); // cursor that fetches page 3 = [5, 6]

  function failingAt(cursor: string, result: DouyinTransportResult) {
    return (req: DouyinRequest) =>
      req.path === LIST && req.form?.cursor === cursor ? result : undefined;
  }

  it('a failed first sync keeps what it stored; the next run tops up the head, then resumes', async () => {
    const world: World = {
      favorites: favs(SIX),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    const first = await run(fakeDouyin(world).transport, FRESH);
    expect(first.error).toBeInstanceOf(DouyinRateLimitError);
    expect(await storedIds()).toEqual(['1', '2', '3', '4']);
    expect(first.last).toEqual({ resumeCursor: PAGE3, backfillDone: false });

    world.intercept = undefined;
    const second = fakeDouyin(world);
    const resumed = await run(second.transport, first.last);
    expect(resumed.error).toBeNull();
    // Head: page 1 is wholly known → stop. Resume: from the stored cursor to the end.
    expect(listCursors(second.requests)).toEqual(['0', PAGE3]);
    expect(resumed.last).toEqual(DONE);
    expect(await storedIds()).toEqual(SIX);
  });

  it('B: a first sync interrupted before any backfill write walks the whole list again, no early stop', async () => {
    const world: World = {
      favorites: favs(SIX),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    // The write never reached storage (onBackfill threw away) → the next run
    // starts again from { resumeCursor: null, backfillDone: false }.
    const first = await run(fakeDouyin(world).transport, FRESH, { onBackfill: () => {} });
    expect(first.error).toBeInstanceOf(DouyinRateLimitError);
    expect(await storedIds()).toEqual(['1', '2', '3', '4']);

    world.intercept = undefined;
    const second = fakeDouyin(world);
    const again = await run(second.transport, FRESH);
    expect(again.error).toBeNull();
    expect(listCursors(second.requests)).toEqual(['0', String(TOP - 1000), PAGE3]);
    expect(again.last).toEqual(DONE);
    expect(await storedIds()).toEqual(SIX);
  });

  it.each<[string, DouyinTransportResult, unknown]>([
    ['F9', ok({ status_code: 2154, status_msg: 'cursor' }), DouyinStatusError],
    ['F8', ok({ status_code: 0, aweme_list: [], cursor: 0, has_more: 1 }), DouyinRateLimitError],
  ])('D-e: a resume segment refused by %s resets to { null, false } and rethrows; the next run walks everything', async (_name, refusal, errorClass) => {
    const world: World = {
      favorites: favs(SIX),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    const first = await run(fakeDouyin(world).transport, FRESH);

    world.intercept = failingAt(PAGE3, refusal);
    const second = await run(fakeDouyin(world).transport, first.last);
    expect(second.error).toBeInstanceOf(errorClass);
    expect(second.last).toEqual(FRESH);

    world.intercept = undefined;
    const third = fakeDouyin(world);
    const healed = await run(third.transport, second.last);
    expect(healed.error).toBeNull();
    expect(listCursors(third.requests)).toEqual(['0', String(TOP - 1000), PAGE3]);
    expect(healed.last).toEqual(DONE);
    expect(await storedIds()).toEqual(SIX);
  });

  it('D-e: a first resume request answered with a cursor above the stored one (F10) resets to { null, false }; the next run walks everything', async () => {
    const world: World = {
      favorites: favs(SIX),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    const first = await run(fakeDouyin(world).transport, FRESH);
    expect(first.last).toEqual({ resumeCursor: PAGE3, backfillDone: false });

    // The server ignored the stored cursor and answered from the top.
    world.intercept = failingAt(
      PAGE3,
      ok({ status_code: 0, aweme_list: [rawAweme('1')], cursor: TOP, has_more: 1 }),
    );
    const second = fakeDouyin(world);
    const refused = await run(second.transport, first.last);
    expect(refused.error).toBeInstanceOf(Error);
    expect((refused.error as Error).message).toMatch(/cursor did not advance/);
    expect(listCursors(second.requests)).toEqual(['0', PAGE3]);
    expect(refused.last).toEqual(FRESH);

    world.intercept = undefined;
    const third = fakeDouyin(world);
    const healed = await run(third.transport, refused.last);
    expect(healed.error).toBeNull();
    expect(listCursors(third.requests)).toEqual(['0', String(TOP - 1000), PAGE3]);
    expect(healed.last).toEqual(DONE);
    expect(await storedIds()).toEqual(SIX);
  });

  it.each<[string, DouyinTransportResult, unknown]>([
    ['F8', ok({ status_code: 0, aweme_list: [], cursor: 0, has_more: 1 }), DouyinRateLimitError],
    ['F9', ok({ status_code: 2154, status_msg: 'risk' }), DouyinStatusError],
  ])('D-e is only the first resume request: %s on a later resume page keeps the breakpoint past the last stored page', async (_name, refusal, errorClass) => {
    const EIGHT = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const PAGE4 = String(TOP - 5000); // cursor that fetches page 4 = [7, 8]
    const world: World = {
      favorites: favs(EIGHT),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    const first = await run(fakeDouyin(world).transport, FRESH);
    expect(first.last).toEqual({ resumeCursor: PAGE3, backfillDone: false });

    // Resume page 1 (the stored cursor) lands [5, 6]; resume page 2 is refused.
    world.intercept = failingAt(PAGE4, refusal);
    const second = fakeDouyin(world);
    const refused = await run(second.transport, first.last);
    expect(refused.error).toBeInstanceOf(errorClass);
    expect(listCursors(second.requests)).toEqual(['0', PAGE3, PAGE4]);
    expect(refused.states).toEqual([{ resumeCursor: PAGE4, backfillDone: false }]);
    expect(await storedIds()).toEqual(['1', '2', '3', '4', '5', '6']);

    // The next run picks up from there instead of walking everything again.
    world.intercept = undefined;
    const third = fakeDouyin(world);
    const resumed = await run(third.transport, refused.last);
    expect(resumed.error).toBeNull();
    expect(listCursors(third.requests)).toEqual(['0', PAGE4]);
    expect(resumed.last).toEqual(DONE);
    expect(await storedIds()).toEqual(EIGHT);
  });

  it('an unusable stored resumeCursor is forgotten at the boundary: a full walk, never a BigInt SyntaxError', async () => {
    const world: World = {
      favorites: favs(SIX),
      intercept: failingAt(PAGE3, { kind: 'response', status: 403, text: '' }),
    };
    await run(fakeDouyin(world).transport, FRESH);

    // Were 'garbage' ever sent, this page would make the walk compare it as a cursor.
    world.intercept = failingAt(
      'garbage',
      ok({ status_code: 0, aweme_list: [rawAweme('5')], cursor: TOP - 4000, has_more: 1 }),
    );
    const second = fakeDouyin(world);
    const healed = await run(second.transport, { resumeCursor: 'garbage', backfillDone: false });
    expect(healed.error).toBeNull();
    expect(listCursors(second.requests)).toEqual(['0', String(TOP - 1000), PAGE3]);
    expect(healed.last).toEqual(DONE);
    expect(await storedIds()).toEqual(SIX);
  });

  it.each<[string, DouyinTransportResult]>([
    ['F9', ok({ status_code: 2154, status_msg: 'x' })],
    ['F8', ok({ status_code: 0, aweme_list: null, cursor: 0, has_more: 1 })],
  ])('the head segment never self-heals: %s there leaves the stored cursor alone', async (_name, refusal) => {
    const stored: DouyinBackfillState = { resumeCursor: PAGE3, backfillDone: false };
    const world: World = { favorites: favs(SIX), intercept: failingAt('0', refusal) };
    const { error, states } = await run(fakeDouyin(world).transport, stored);
    expect(error).toBeInstanceOf(Error);
    expect(states).toEqual([]);
  });

  it('a done backfill whose head reaches has_more 0 writes nothing', async () => {
    const { transport } = fakeDouyin({ favorites: favs(['1']) });
    const { states, error } = await run(transport, DONE);
    expect(error).toBeNull();
    expect(states).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getDouyinItems orders by publishedAt desc and searches title / author / desc', async () => {
    const list: Fav[] = [
      { raw: rawAweme('1', { desc: 'older cat video', create_time: 1_600_000_000 }), ts: TOP },
      { raw: rawAweme('2', { desc: 'newer dog\nwith a 100%_ deal', create_time: 1_700_000_000 }), ts: TOP - 1000 },
      {
        raw: rawAweme('3', {
          desc: 'third',
          create_time: 1_650_000_000,
          author: { sec_uid: 'bob', nickname: 'Bob Cats' },
        }),
        ts: TOP - 2000,
      },
    ];
    await run(fakeDouyin({ favorites: list, pageSize: 10 }).transport, FRESH);

    const all = await getDouyinItems({ page: 1, pageSize: 10 }, db);
    expect(all.rows.map((r) => r.awemeId)).toEqual(['2', '3', '1']);

    const cats = await getDouyinItems({ search: 'cat', page: 1, pageSize: 10 }, db);
    expect(cats.rows.map((r) => r.awemeId).sort()).toEqual(['1', '3']);

    // desc beyond the title's first line is searchable; LIKE metacharacters are literal.
    const deal = await getDouyinItems({ search: '100%_', page: 1, pageSize: 10 }, db);
    expect(deal.rows.map((r) => r.awemeId)).toEqual(['2']);

    const paged = await getDouyinItems({ page: 2, pageSize: 2 }, db);
    expect(paged.total).toBe(3);
    expect(paged.rows.map((r) => r.awemeId)).toEqual(['1']);
  });
});
