/**
 * Douyin (抖音) favorites domain sync service — the ONLY holder of DB schema
 * knowledge for the `douyin` platform (mirrors lib/zhihu/zhihu-sync-service.ts
 * layering). Consumers (hooks / UI) call the operations here and never import
 * drizzle / entities / getDb.
 *
 * Model (docs/33 D1): EVERY favorite (`aweme/listcollection`) becomes a
 * Collection Item; a PUBLIC folder (`status === 1`) is a Source and its items
 * get `item_sources` links. A private folder is not a Source, but its videos
 * still arrive through the all-favorites list — a deliberate departure from
 * bilibili / zhihu, where a private folder's items are not Collection Items.
 * Items seen only in the all-favorites list carry NO Source (D-a: a synthetic
 * "all favorites" Source would show up as a fake folder chip).
 *
 * Unlike x / zhihu, every page is persisted as it arrives (`ingestCollection`
 * per page) and the caller hears each page's content-persisted ids
 * (`onPagePersisted`, D-b): a first full sync is paced at roughly 2 minutes
 * per 100 favorites (docs/33 Step 3), and a run that fails half way must
 * neither lose what it fetched nor leave items that are chunked but never
 * dispatched to the embed / tag lanes. Where the first
 * full walk stopped is a two-field breakpoint the caller stores (design B,
 * `lib/douyin/CLAUDE.md`).
 *
 * The insert-only rule (lib/ingest/CLAUDE.md) applies: items / authors /
 * item_sources are insert-only; `sources` rows upsert. Un-favorited videos
 * are never deleted.
 *
 * Storage-free: no chrome.*, no `@/lib/storage`, no tagging / embedding
 * barrel. The transport and the breakpoint state come from the caller.
 */

import { eq, sql, type SQL } from 'drizzle-orm';
import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import {
  pagedItemsQuery,
  platformItemIds,
  searchCondition,
  sourceItemCounts,
  sourceMembership,
  type PagedItemRow,
} from '@/lib/database/collection-queries';
import { items } from '@/lib/database/entities/items';
// Leaf import, never the '@/lib/embedding' barrel (its value re-export of
// './config' reaches '@/lib/storage' at module load).
import { charSplit } from '@/lib/embedding/char-split';
import { envNumber } from '@/lib/env';
import { ingestCollection, type IngestResult } from '@/lib/ingest/ingest';
import {
  createDouyinPacer,
  decodeCursor,
  fetchPublicFolders,
  walkCollection,
  walkFolderItems,
  type DouyinAwemePage,
  type DouyinFolder,
  type DouyinPacer,
  type DouyinRawAweme,
  type DouyinSession,
  type DouyinTransport,
} from './douyin-api';

// Re-export what service consumers actually need: structured errors + the
// types appearing in public signatures below.
export { DouyinAuthError, DouyinRateLimitError, DouyinStatusError } from './douyin-api';
export type {
  DouyinPacer,
  DouyinRequest,
  DouyinTransport,
  DouyinTransportResult,
} from './douyin-api';

const PLATFORM = 'douyin';
/** Card title = the desc's first non-empty line, cut to N chars (full desc lives in platformMeta). */
const TITLE_MAX_CHARS = envNumber('VITE_DOUYIN_TITLE_MAX_CHARS', 140);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface DouyinItemMeta {
  desc: string;
  authorName: string;
  authorSecUid: string;
  avatarUrl: string;
  coverUrl: string | null;
  durationMs: number | null;
  mediaKind: 'video' | 'note';
  /** First-seen public folder (display only); filtering goes through item_sources. */
  folderId: string | null;
  folderTitle: string | null;
  /**
   * Where the item sat in the all-favorites list when it was first inserted
   * (docs/33 D5): the cursor its page's response returned (null on the last
   * page) and its index in that page. Both null when the item was first seen
   * in a public folder's page — first-write-wins, a later list page does not
   * fill them in. Write-only today: nothing reads them and sorting stays on
   * publishedAt. Whether the cursor is a favorite time is unknown, hence the
   * neutral names.
   */
  listCursor: string | null;
  listIndex: number | null;
}

/**
 * Which kind of page an aweme arrived in. A page of the all-favorites list
 * (head or resume segment) gives its items a list position and no Source; a
 * public folder's page gives them the folder — as the link and as the
 * first-seen display meta — and no position (its cursor is an offset, a
 * different key).
 */
type PageOrigin =
  | { kind: 'list'; nextCursor: string | null }
  | { kind: 'folder'; folder: DouyinFolder };

/**
 * Where the first full walk of the all-favorites list stopped. Stored by the
 * caller (app-side storage), read at the start of a run, rewritten through
 * `onBackfill` on every change.
 * - `{ null, false }` — never completed and nothing to resume from: walk the
 *   whole list from the top without the "whole page known" stop.
 * - `{ cursor, false }` — top up the head, then resume from `cursor`.
 * - `{ null, true }` — done: the head alone, stopping at a known page.
 * A stored `resumeCursor` that is not a digit string is read as `null`.
 */
export interface DouyinBackfillState {
  resumeCursor: string | null;
  backfillDone: boolean;
}

/** Progress after each page: cumulative awemes fetched, cumulative pages. */
export type DouyinProgressCallback = (fetchedCount: number, page: number) => void;

export interface SyncDouyinOptions {
  backfill: DouyinBackfillState;
  onBackfill?: (state: DouyinBackfillState) => void | Promise<void>;
  /**
   * platformItemIds whose content landed in one ingest call — a page's, or the
   * run-opening sweep's (D-g: ghosts an earlier run left) — dispatch them now (D-b).
   */
  onPagePersisted?: (platformItemIds: string[]) => void;
  onProgress?: DouyinProgressCallback;
  control?: CooperativeCheckpoint;
  /** Test seam; production uses `createDouyinPacer()`. */
  pacer?: DouyinPacer;
  /** Test seam for the cooldown `resetAt`; defaults to `Date.now`. */
  now?: () => number;
}

export interface SyncDouyinResult {
  /** Awemes received across every page (an item in the list and a folder counts twice). */
  fetched: number;
  /** Items newly inserted this run. */
  inserted: number;
  /** Public folders found. */
  folders: number;
  /** Every platformItemId whose content landed this run (the union of the `onPagePersisted` calls). */
  newItemIds: string[];
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface DouyinItem {
  /** items.id (uuid) */
  id: string;
  /** aweme_id (items.platformItemId) */
  awemeId: string;
  title: string;
  desc: string;
  authorName: string;
  authorSecUid: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  durationMs: number | null;
  mediaKind: 'video' | 'note';
  folderId: string | null;
  folderTitle: string | null;
  originalUrl: string;
  /** Publish time — Douyin has no per-item favorite time. */
  publishedAt: Date | null;
}

export interface DouyinQuery {
  /** Restrict to one public folder (sources.platformSourceId). Omit = whole library. */
  folderId?: string;
  /** ILIKE match on title / author name / desc. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

/** Folder chip data — one per public folder that has items. */
export interface DouyinFolderCount {
  folderId: string;
  title: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/**
 * One sync run against the user's open douyin.com tab (the `transport`).
 * Order: public folders → Sources, in the call that also sweeps the ghosts an
 * earlier run left (D-g); the head of the all-favorites list; the resumed
 * backfill when one is pending; every public folder's items with links.
 * Throws what the API layer throws (`DouyinAuthError`,
 * `DouyinRateLimitError`, `DouyinStatusError`, Error); pages persisted before
 * the throw stay persisted and the breakpoint already points past them.
 */
export async function syncDouyinCollections(
  transport: DouyinTransport,
  opts: SyncDouyinOptions,
): Promise<SyncDouyinResult> {
  return syncDouyinCollectionsToDb(getDb(), transport, opts);
}

/** `syncDouyinCollections` with the db injected. Exported for tests (in-memory PGlite). */
export async function syncDouyinCollectionsToDb(
  db: FavbaseDb,
  transport: DouyinTransport,
  opts: SyncDouyinOptions,
): Promise<SyncDouyinResult> {
  const session: DouyinSession = {
    transport,
    pacer: opts.pacer ?? createDouyinPacer(),
    control: opts.control,
    now: opts.now,
  };

  // The breakpoint comes back from app storage, so it is checked here, at
  // the boundary: a resumeCursor that is not a digit string would surface as
  // a BigInt SyntaxError mid-walk. Unusable → forgotten, exactly like D-e: the
  // run walks everything from the top.
  let state: DouyinBackfillState = {
    resumeCursor: decodeCursor(opts.backfill.resumeCursor),
    backfillDone: opts.backfill.backfillDone === true,
  };
  const setState = async (next: DouyinBackfillState) => {
    if (next.resumeCursor === state.resumeCursor && next.backfillDone === state.backfillDone) return;
    state = next;
    await opts.onBackfill?.({ ...state });
  };

  const known = await platformItemIds(db, PLATFORM);
  let fetched = 0;
  let pages = 0;
  let inserted = 0;
  const newItemIds: string[] = [];

  const countPage = (page: DouyinAwemePage) => {
    fetched += page.awemes.length;
    pages += 1;
    opts.onProgress?.(fetched, pages);
  };

  // The one exit for content that landed, whichever ingest call wrote it.
  const report = (result: IngestResult) => {
    inserted += result.inserted.length;
    if (result.contentPersisted.length > 0) {
      newItemIds.push(...result.contentPersisted);
      opts.onPagePersisted?.(result.contentPersisted);
    }
  };

  const persist = async (awemes: DouyinRawAweme[], origin: PageOrigin) => {
    if (awemes.length === 0) return;
    const result = await ingestPage(db, awemes, origin);
    report(result);
    const dropped = new Set(result.droppedItemIds);
    for (const aweme of awemes) if (!dropped.has(aweme.id)) known.add(aweme.id);
  };

  // 1. Public folders → Sources. An empty public folder is still a Source.
  //    The call is unconditional and carries `content` (D-g): it is the run's
  //    one guaranteed ghost sweep. An incremental run whose first head page is
  //    wholly known ingests no page at all, and the items an earlier run left
  //    without chunks would otherwise wait for the next new favorite. No text
  //    is in hand here; the sweep re-chunks what the insert tx stored.
  const folders = await fetchPublicFolders(session);
  report(
    await ingestCollection(db, {
      platform: PLATFORM,
      sources: folders.map((folder) => ({ platformSourceId: folder.id, title: folder.title })),
      authors: [],
      items: [],
      links: [],
      content: { textOf: () => '', chunk: chunkDesc },
    }),
  );

  // 2. Head segment, from the newest favorite. A full walk (no breakpoint and
  //    never completed) does not stop at a known page and writes the cursor
  //    after every persisted page; otherwise a page whose every item is
  //    already stored ends the segment — a page, not the first known id: a
  //    re-favorited old video moves to the top above the new ones.
  const fullWalk = !state.backfillDone && state.resumeCursor === null;
  const headEnd = await walkCollection(session, '0', async (page) => {
    countPage(page);
    if (!fullWalk && page.awemes.length > 0 && page.awemes.every((a) => known.has(a.id))) {
      return 'stop';
    }
    await persist(page.awemes, { kind: 'list', nextCursor: page.nextCursor });
    if (fullWalk && page.nextCursor !== null) {
      await setState({ resumeCursor: page.nextCursor, backfillDone: false });
    }
    return 'continue';
  });
  if (headEnd === 'end') await setState({ resumeCursor: null, backfillDone: true });

  // 3. Resume segment — only when this run started from a stored breakpoint
  //    (a full walk that hit the page fuse resumes on the NEXT run).
  const resumeFrom = state.resumeCursor;
  if (!fullWalk && !state.backfillDone && resumeFrom !== null) {
    const resumeEnd = await walkCollection(
      session,
      resumeFrom,
      async (page) => {
        countPage(page);
        await persist(page.awemes, { kind: 'list', nextCursor: page.nextCursor });
        if (page.nextCursor !== null) {
          await setState({ resumeCursor: olderCursor(state.resumeCursor, page.nextCursor), backfillDone: false });
        }
        return 'continue';
      },
      // D-e: the STORED cursor may no longer be accepted (cross-day validity
      // is unknown). Only the first request carries it; if that one is
      // refused (F8 / F9) or answered with a cursor that does not move below
      // it (F10), forget it so the next run walks everything from the top — a
      // resume that keeps failing would otherwise never finish. A refusal on a
      // later page (a cursor the server just handed out) is risk control and
      // keeps the breakpoint where the last persisted page left it.
      { onStartCursorRejected: () => setState({ resumeCursor: null, backfillDone: false }) },
    );
    if (resumeEnd === 'end') await setState({ resumeCursor: null, backfillDone: true });
  }

  // 4. Every public folder in full, with links. An item that is only in a
  //    folder (the list walk has not reached it yet) is ingested here too.
  for (const folder of folders) {
    await walkFolderItems(session, folder.id, async (page) => {
      countPage(page);
      await persist(page.awemes, { kind: 'folder', folder });
      return 'continue';
    });
  }

  return { fetched, inserted, folders: folders.length, newItemIds };
}

/** The older (smaller) of two µs cursors; the walk already guarantees it, this keeps the write monotone. */
function olderCursor(current: string | null, next: string): string {
  if (current === null) return next;
  return BigInt(next) < BigInt(current) ? next : current;
}

/** First non-empty line of the desc, cut to TITLE_MAX_CHARS; the nickname (then the id) when empty. */
function titleOf(aweme: DouyinRawAweme): string {
  const line = aweme.desc
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, TITLE_MAX_CHARS) : aweme.author.nickname || aweme.id;
}

function originalUrlOf(aweme: DouyinRawAweme): string {
  const kind = aweme.mediaKind === 'note' ? 'note' : 'video';
  return `https://www.douyin.com/${kind}/${aweme.id}`;
}

/** The desc is sentence-only text like a tweet: no paragraph preference. */
function chunkDesc(text: string) {
  return charSplit(text, { preferParagraph: false });
}

/** One page → one `ingestCollection` call. Sources are upserted once per run, so none here. */
function ingestPage(
  db: FavbaseDb,
  awemes: DouyinRawAweme[],
  origin: PageOrigin,
): Promise<IngestResult> {
  const descById = new Map(awemes.map((a) => [a.id, a.desc]));
  const folder = origin.kind === 'folder' ? origin.folder : null;
  return ingestCollection(db, {
    platform: PLATFORM,
    sources: [],
    // An aweme without sec_uid has no author row, so ingest drops the item
    // (the X rule for an empty author id).
    authors: awemes
      .filter((a) => a.author.secUid)
      .map((a) => ({
        platformAuthorId: a.author.secUid,
        name: a.author.nickname || a.author.secUid,
        avatarUrl: a.author.avatarUrl || null,
      })),
    items: awemes.map((a, index) => ({
      platformItemId: a.id,
      platformAuthorId: a.author.secUid,
      title: titleOf(a),
      authorName: a.author.nickname,
      originalUrl: originalUrlOf(a),
      publishedAt: a.createTime !== null ? new Date(a.createTime * 1000) : null,
      // The desc is the Content, in hand at sync time: never 'pending'.
      contentState: a.desc.trim() ? ('chunked' as const) : ('no_content' as const),
      platformMeta: {
        desc: a.desc,
        authorName: a.author.nickname,
        authorSecUid: a.author.secUid,
        avatarUrl: a.author.avatarUrl,
        coverUrl: a.coverUrl,
        durationMs: a.durationMs,
        mediaKind: a.mediaKind,
        folderId: folder?.id ?? null,
        folderTitle: folder?.title ?? null,
        listCursor: origin.kind === 'list' ? origin.nextCursor : null,
        listIndex: origin.kind === 'list' ? index : null,
      } satisfies DouyinItemMeta,
    })),
    links: folder ? awemes.map((a) => ({ platformItemId: a.id, platformSourceId: folder.id })) : [],
    content: { textOf: (id) => descById.get(id) ?? '', chunk: chunkDesc },
  });
}

// ---------------------------------------------------------------------------
// Public API — queries (the douyin page reads from PGlite, not the API)
// ---------------------------------------------------------------------------

/**
 * Paged favorites, publishedAt descending (Douyin gives no favorite time, so
 * "newest" is the newest publish). Optional folder chip filter (through
 * item_sources) + ILIKE search over title / author name / desc.
 */
export async function getDouyinItems(
  query: DouyinQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: DouyinItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];

  conditions.push(sourceMembership(PLATFORM, query.folderId));
  conditions.push(
    searchCondition(query.search, [
      items.title,
      items.authorName,
      sql`${items.platformMeta}->>'desc'`,
    ]),
  );

  return pagedItemsQuery(db, {
    conditions,
    orderBy: sql`${items.publishedAt} DESC NULLS LAST`,
    page: query.page,
    pageSize: query.pageSize,
    mapRow: toDouyinItem,
  });
}

/** Public folders that have items, with counts descending — data for the chip row. */
export async function getFolderCounts(db: FavbaseDb = getDb()): Promise<DouyinFolderCount[]> {
  const rows = await sourceItemCounts(db, PLATFORM);
  return rows.map((r) => ({ folderId: r.platformSourceId, title: r.title, count: r.count }));
}

// ---------------------------------------------------------------------------
// Meta narrowing + row mapper (shared with the tagged-card adapter)
// ---------------------------------------------------------------------------

export type NarrowedDouyinMeta = Omit<
  DouyinItem,
  'id' | 'awemeId' | 'title' | 'originalUrl' | 'publishedAt'
>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Defensive platformMeta → DouyinItem field narrowing, the SINGLE source of
 * truth, read through `toDouyinItem`. desc falls back to the row's title and
 * authorName to the row's authorName (an empty string is kept; only a
 * non-string falls back).
 */
export function narrowDouyinMeta(
  meta: unknown,
  fb: { title: string; authorName: string },
): NarrowedDouyinMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  const duration = m.durationMs;
  return {
    desc: typeof m.desc === 'string' ? m.desc : fb.title,
    authorName: typeof m.authorName === 'string' ? m.authorName : fb.authorName,
    authorSecUid: typeof m.authorSecUid === 'string' ? m.authorSecUid : '',
    avatarUrl: nonEmptyString(m.avatarUrl),
    coverUrl: nonEmptyString(m.coverUrl),
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
    mediaKind: m.mediaKind === 'note' ? 'note' : 'video',
    folderId: nonEmptyString(m.folderId),
    folderTitle: nonEmptyString(m.folderTitle),
  };
}

/** Row → `DouyinItem`; the paged query's mapRow and the tagged-card adapter's mapper (`taggedCard`). */
export function toDouyinItem(row: PagedItemRow): DouyinItem {
  return {
    id: row.id,
    awemeId: row.platformItemId,
    title: row.title,
    originalUrl: row.originalUrl,
    publishedAt: row.publishedAt,
    ...narrowDouyinMeta(row.platformMeta, { title: row.title, authorName: row.authorName }),
  };
}
