/**
 * Shared collection-ingest pipeline — single owner of the five-stage
 * insert-only transaction skeleton that every platform sync-service used to
 * copy (audit docs/16 HIGH-1). Platforms declare normalized rows (+ their
 * content chunker); this module holds the schema knowledge and invariants:
 *
 * - transaction boundary: one insert-only tx for sources/authors/items/links;
 * - `sources` upsert is the allowed exception (title / platformMeta /
 *   lastFetchedAt freshness — renames flow through), and runs even when items
 *   are empty so every Source the platform reported is refreshed. Whether the
 *   PLATFORM ever synced is no longer read off these rows — that is the
 *   Platform Sync Record (lib/database/platform-sync-record.ts, docs/32 §5.1);
 * - authors / items / item_sources are insert-only (`onConflictDoNothing`,
 *   first-write-wins — the rule is recorded in lib/ingest/CLAUDE.md and
 *   .trellis/spec/frontend/platform-onboarding.md §4.3);
 * - batched INSERTs (`chunk(500)` keeps bind-params < PG 65535; `item_contents`
 *   rows go in far smaller batches, sized by statement length);
 * - id maps re-selected by platform (covers rows that existed before this
 *   run — a known item newly added to another source still gets its link);
 * - `preExisting` diff: content is persisted for NEWLY inserted items — plus
 *   the platform's GHOST items (see below), which self-heal on every sync;
 * - two-phase content write: a new item's text (`item_contents`) goes in WITH
 *   its row, inside the tx; its chunks go OUTSIDE the tx, item by item
 *   (replaceItemChunks opens its own transaction — nesting on the
 *   single-connection proxy would deadlock). Embedding is deferred (D3) —
 *   the app-side Platform Sync funnel (entrypoints/app/hooks/platform-sync.ts)
 *   dispatches the shared embed lane after the sync returns;
 * - opaque text is stored as `storableText`: U+0000 stripped (Postgres `text`
 *   cannot hold it), then trimmed, before any emptiness check.
 *
 * GHOSTS. An interrupted phase-5 run (page close, dev reload, mid-run error)
 * used to leave items that CLAIMED 'chunked' with zero chunk rows — invisible
 * to both the embed batch (skipped silently) and the settings rebuild (its
 * EXISTS(chunks) filter). Three rules eliminate them:
 *   1. 'chunked' is only ever written AFTER chunk rows are persisted. Items
 *      declared 'chunked' by the platform are INSERTED as 'has_content' and
 *      flipped per item in phase 5 by `chunkAndSettle` — the one place a
 *      chunk write is turned into a state, also under `settleItemContent`
 *      (bookmark extraction).
 *   2. 'has_content' means the text is STORED (docs/33 D6): the text of a new
 *      declared-'chunked' item is written in the same tx as its row, and a
 *      blank one is inserted as 'no_content' straight away. A run cut short in
 *      phase 5 therefore leaves every item it did not reach with its text —
 *      the next sync need not have that text in hand (an incremental or
 *      page-sized `textOf` usually does not).
 *   3. When `content` is provided, phase 5 also sweeps the platform's ghosts
 *      (state IN ('chunked','has_content') with no chunk rows): re-chunk from
 *      `textOf` or the persisted `item_contents.plainText`; when neither text
 *      source exists, settle honestly at 'no_content' — reachable only for a
 *      ghost that predates rule 2. Healed ids join `contentPersisted`, so
 *      they flow into the embed/tag lanes like new ones.
 *
 * Offscreen-safe: zero '@/lib/storage' reach. `replaceItemChunks` is a leaf
 * import (the '@/lib/embedding' barrel touches chrome.storage at module load,
 * which offscreen documents don't have — same rule as x-sync-service).
 */

import { and, eq, exists, inArray, not, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { chunk } from '@/lib/database/sql-utils';
import { platformItemIds } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items, type NewItem } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemContents } from '@/lib/database/entities/item-contents';
import { itemChunks } from '@/lib/database/entities/item-chunks';
import { replaceItemChunks } from '@/lib/embedding/vector-store';
import type { ChunkInput } from '@/lib/embedding/types';
import type { SubtitleSource } from '@/lib/subtitle/types';

/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;
/**
 * `item_contents` rows per INSERT batch. Sized by statement length, not by
 * bind params: one text can reach 100 KB (github's MAX_README_CHARS), so 500
 * rows would be a 50 MB statement; 20 keeps a batch of capped texts near
 * 2 MB. zhihu's Markdown has no cap, so this bounds the row count, not the
 * bytes.
 */
const CONTENT_INSERT_CHUNK_SIZE = 20;

export interface IngestSource {
  platformSourceId: string;
  title: string;
  /** Refreshed on upsert alongside title (e.g. bookmarks folder path). Omit = `{}`. */
  platformMeta?: unknown;
}

export interface IngestAuthor {
  platformAuthorId: string;
  name: string;
  avatarUrl: string | null;
}

export interface IngestItem {
  platformItemId: string;
  /** Resolved to authors.id inside the tx; unresolvable → item dropped. */
  platformAuthorId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  publishedAt: Date | null;
  contentState: 'pending' | 'no_content' | 'chunked';
  platformMeta: unknown;
}

export interface IngestLink {
  platformItemId: string;
  platformSourceId: string;
}

export interface IngestContent {
  /**
   * Raw text of an item: asked for each new item (stored with its row) and
   * for each ghost (the sweep). The pipeline strips U+0000 and trims it
   * before anything else (`storableText`); what is left empty → no content.
   * An id this call does not know returns ''.
   */
  textOf: (platformItemId: string) => string;
  /** Content-type chunker — platform knowledge stays in the caller. */
  chunk: (plainText: string) => ChunkInput[];
}

export interface IngestInput {
  platform: string;
  sources: IngestSource[];
  authors: IngestAuthor[];
  /** Deduped by platformItemId inside the pipeline (first-seen wins). */
  items: IngestItem[];
  /** Deduped per (item, source) pair inside the pipeline. */
  links: IngestLink[];
  /** When present, content + chunks are persisted for newly inserted items. */
  content?: IngestContent;
}

export interface IngestedItem {
  platformItemId: string;
  /** items.id (uuid) */
  itemId: string;
}

export interface IngestResult {
  /** Items newly inserted this run (healed ghosts are not in here — see `healedItemIds`). */
  inserted: IngestedItem[];
  /**
   * platformItemIds whose content + chunks were actually written this run
   * ((newly inserted ∪ healed ghosts) ∩ non-empty text) — the content-persisted
   * seam callers feed to auto-tagging (audit docs/16 MEDIUM-2). Empty when
   * `content` is absent from the input.
   */
  contentPersisted: string[];
  /** Subset of `contentPersisted`: pre-existing ghosts healed this run. */
  healedItemIds: string[];
  /** platformItemIds dropped because their author row could not be resolved. */
  droppedItemIds: string[];
  /** platformItemIds of links that failed to resolve (author drops excluded). */
  droppedLinkItemIds: string[];
  /** item_sources rows written this run (post-dedupe). */
  linkCount: number;
}

/**
 * Ghost predicate: rows claiming content ('chunked'/'has_content') with zero
 * chunk rows. Single source for the ingest heal sweep and platform-side diffs
 * (github's README refetch). Callers AND it with their platform filter.
 */
export function ghostItemCondition(db: FavbaseDb) {
  return and(
    inArray(items.contentState, ['chunked', 'has_content']),
    not(
      exists(
        db
          .select({ one: sql`1` })
          .from(itemChunks)
          .where(eq(itemChunks.itemId, items.id)),
      ),
    ),
  );
}

/**
 * The form in which opaque text enters `item_contents` through this module:
 * U+0000 removed, then trimmed. A Postgres `text` value cannot hold U+0000 —
 * the write fails with `invalid byte sequence for encoding "UTF8": 0x00` —
 * and since a new item's text is stored in the insert transaction, one such
 * text used to roll the whole ingest back (a UTF-16 README decoded as UTF-8
 * is full of them). No text that was storable before changes.
 *
 * Normalise BEFORE any emptiness check: a text made only of NULs is blank.
 * Chunkers only ever see the normalised text. Not covered, on purpose:
 * `persistExistingItemContent` (its prepared chunks are the caller's) and a
 * NUL inside `title` / `platform_meta`, which fails the insert transaction.
 */
function storableText(text: string): string {
  return text.replaceAll('\u0000', '').trim();
}

/**
 * Upsert ONE item's opaque text into `item_contents`; `plainText` must be
 * `storableText` output and non-empty. Only `settleItemContent` calls it — module-private so
 * that writing content and hand-setting `content_state` cannot be paired
 * anywhere else. (A NEW item's text does not come through here: the insert
 * transaction of `ingestCollection` writes it with the item row.)
 *
 * The text is never a transcript, so `subtitle_source` is written as NULL in
 * the same statement — every write of `plain_text` also writes
 * `subtitle_source`, so a stale 'asr'/'official' can never outlive its text.
 */
async function persistItemContent(db: FavbaseDb, itemId: string, plainText: string): Promise<void> {
  await db
    .insert(itemContents)
    .values({ itemId, plainText, subtitleSource: null })
    .onConflictDoUpdate({
      target: itemContents.itemId,
      set: { plainText, subtitleSource: null, updatedAt: new Date() },
    });
}

/**
 * Rebuild one item's chunk rows from text that is ALREADY in `item_contents`
 * (or blank), then settle its `content_state`: chunk rows written ⇒
 * 'chunked', anything else (blank text, a chunker that yields nothing) ⇒
 * 'no_content'. `plainText` must be trimmed. Runs OUTSIDE any caller
 * transaction (`replaceItemChunks` opens its own — nesting on the
 * single-connection proxy deadlocks).
 *
 * The single owner of GHOSTS rule 1 above: 'chunked' is only ever written
 * AFTER the chunk rows are, and never over an empty chunk set (the
 * ghost-sweep convergence guarantee). It does not touch `item_contents` —
 * the ingest content step calls it directly for text the insert transaction
 * (new items) or an earlier run (a ghost) already stored. Module-private, for
 * the same reason as `persistItemContent`.
 */
async function chunkAndSettle(
  db: FavbaseDb,
  itemId: string,
  plainText: string,
  chunkText: (plainText: string) => ChunkInput[],
): Promise<boolean> {
  const written = plainText
    ? (await replaceItemChunks(db, itemId, chunkText(plainText))).length > 0
    : false;
  await db
    .update(items)
    .set({ contentState: written ? 'chunked' : 'no_content', updatedAt: new Date() })
    .where(eq(items.id, itemId));
  return written;
}

/**
 * Write one item's opaque-text content and settle its `content_state`: chunk
 * rows written ⇒ 'chunked', anything else (blank text, a chunker that yields
 * nothing) ⇒ 'no_content'. Returns whether chunk rows were written — `true`
 * is the caller's license to dispatch Embed / Tag for the item.
 *
 * `persistItemContent` (blank text skips it), then `chunkAndSettle`. Used by
 * deferred extraction (`saveBookmarkContent`) and by the ghost sweep when
 * this run's `textOf` supplies the text. It emits no domain event and
 * dispatches no processing lane — both are the caller's. A transcript
 * (timestamped chunks, a subtitle source, addressed by platform identity)
 * goes through `persistExistingItemContent` instead.
 */
export async function settleItemContent(
  db: FavbaseDb,
  itemId: string,
  text: string,
  chunkText: (plainText: string) => ChunkInput[],
): Promise<boolean> {
  const plainText = storableText(text);
  if (plainText) await persistItemContent(db, itemId, plainText);
  return chunkAndSettle(db, itemId, plainText, chunkText);
}

/**
 * Replace durable content for an item that already exists in the collection.
 * The caller addresses the item by platform identity and supplies prepared
 * chunks, so database UUID lookup and the `chunked` state transition stay
 * inside the ingest module. Content and `has_content` commit before chunk
 * replacement, so a replacement failure never leaves stale `embedded` state
 * over new text. Missing items and blank text are explicit no-ops.
 *
 * `subtitleSource` says how a transcript was obtained ('official' / 'asr');
 * `null` = the content is not a transcript. Required with no default: a
 * transcript whose subtitle source is silently dropped is exactly docs/29 C6.
 * It replaces the stored value together with the text, in the same upsert.
 *
 * Known gap: the text is trimmed but NOT run through `storableText`. The
 * chunks arrive prepared, so stripping U+0000 from the text alone would leave
 * it in the chunk rows; a transcript carrying one fails here as it always did.
 */
export async function persistExistingItemContent(
  db: FavbaseDb,
  platform: string,
  platformItemId: string,
  text: string,
  preparedChunks: ChunkInput[],
  subtitleSource: SubtitleSource | null,
): Promise<'chunked' | null> {
  const plainText = text.trim();
  if (!plainText || preparedChunks.length === 0) return null;

  const target = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.platform, platform), eq(items.platformItemId, platformItemId)))
    .limit(1);
  if (target.length === 0) return null;

  const itemId = target[0].id;
  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(itemContents)
      .values({ itemId, plainText, subtitleSource })
      .onConflictDoUpdate({
        target: itemContents.itemId,
        set: { plainText, subtitleSource, updatedAt },
      });
    await tx
      .update(items)
      .set({ contentState: 'has_content', updatedAt })
      .where(eq(items.id, itemId));
  });

  await replaceItemChunks(db, itemId, preparedChunks);
  await db
    .update(items)
    .set({ contentState: 'chunked', updatedAt: new Date() })
    .where(eq(items.id, itemId));
  return 'chunked';
}

export async function ingestCollection(db: FavbaseDb, input: IngestInput): Promise<IngestResult> {
  const { platform } = input;

  // Deduped up front (first-seen wins) — step 3 consults the DECLARED state
  // to know which new items carry content.
  const itemByPid = new Map<string, IngestItem>();
  for (const item of input.items) {
    if (!itemByPid.has(item.platformItemId)) itemByPid.set(item.platformItemId, item);
  }

  const { storedText, ...result } = await db.transaction(async (tx) => {
    // 1. Sources upsert (ADR-allowed exception: title + platformMeta +
    //    lastFetchedAt freshness).
    const now = new Date();
    const sourceValues = input.sources.map((s) => ({
      platform,
      platformSourceId: s.platformSourceId,
      title: s.title,
      platformMeta: s.platformMeta ?? {},
      lastFetchedAt: now,
    }));
    for (const batch of chunk(sourceValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(sources)
        .values(batch)
        .onConflictDoUpdate({
          target: [sources.platform, sources.platformSourceId],
          set: {
            title: sql`excluded.title`,
            platformMeta: sql`excluded.platform_meta`,
            lastFetchedAt: sql`excluded.last_fetched_at`,
            updatedAt: sql`NOW()`,
          },
        });
    }

    const sourceRows = await tx
      .select({ id: sources.id, platformSourceId: sources.platformSourceId })
      .from(sources)
      .where(eq(sources.platform, platform));
    const sourceIdMap = new Map(sourceRows.map((r) => [r.platformSourceId, r.id]));

    // 2. Authors deduped by platformAuthorId (first-seen wins), insert-only.
    const authorByPid = new Map<string, IngestAuthor>();
    for (const author of input.authors) {
      if (!authorByPid.has(author.platformAuthorId)) {
        authorByPid.set(author.platformAuthorId, author);
      }
    }
    const authorValues = [...authorByPid.values()].map((a) => ({
      platform,
      platformAuthorId: a.platformAuthorId,
      name: a.name,
      avatarUrl: a.avatarUrl,
    }));
    for (const batch of chunk(authorValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(authors)
        .values(batch)
        .onConflictDoNothing({ target: [authors.platform, authors.platformAuthorId] });
    }

    const authorRows = await tx
      .select({ id: authors.id, platformAuthorId: authors.platformAuthorId })
      .from(authors)
      .where(eq(authors.platform, platform));
    const authorIdMap = new Map(authorRows.map((r) => [r.platformAuthorId, r.id]));

    // 3. Items — insert-only, first-write-wins. Track pre-existing ids so
    //    content below is persisted for fresh rows only.
    const preExisting = await platformItemIds(tx, platform);

    const droppedItemIds: string[] = [];
    const itemValues: NewItem[] = [];
    /** platformItemId → trimmed text of the NEW items that carry content (step 4b). */
    const storedText = new Map<string, string>();
    for (const item of itemByPid.values()) {
      const authorId = authorIdMap.get(item.platformAuthorId);
      if (!authorId) {
        droppedItemIds.push(item.platformItemId);
        continue;
      }
      // 'chunked' may only be claimed AFTER chunk rows land (phase 5, outside
      // this tx). Content-bearing items enter as 'has_content', and their
      // text enters with them (step 4b): an interrupted run leaves them
      // there, where any later sync's ghost sweep re-chunks the stored text.
      // A new item whose text is blank has nothing to wait for — it is born
      // 'no_content'. Without a `content` block there is no text to read:
      // declared 'chunked' stays 'has_content', as before.
      let contentState: 'pending' | 'no_content' | 'has_content' =
        item.contentState === 'chunked' ? 'has_content' : item.contentState;
      if (
        item.contentState === 'chunked' &&
        input.content &&
        !preExisting.has(item.platformItemId)
      ) {
        const plainText = storableText(input.content.textOf(item.platformItemId));
        if (plainText) storedText.set(item.platformItemId, plainText);
        else contentState = 'no_content';
      }
      itemValues.push({
        platform,
        platformItemId: item.platformItemId,
        authorId,
        title: item.title,
        authorName: item.authorName,
        originalUrl: item.originalUrl,
        publishedAt: item.publishedAt,
        contentState,
        platformMeta: item.platformMeta,
      });
    }
    for (const batch of chunk(itemValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });
    }

    // 4. Links — resolved via the re-selected id maps (covers items that
    //    existed before this run), deduped per (item, source) pair.
    const itemRows = await tx
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, platform));
    const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

    const droppedItemIdSet = new Set(droppedItemIds);
    const droppedLinkItemIds: string[] = [];
    const seenLinks = new Set<string>();
    const linkValues: Array<{ itemId: string; sourceId: string }> = [];
    for (const link of input.links) {
      const itemId = itemIdMap.get(link.platformItemId);
      const sourceId = sourceIdMap.get(link.platformSourceId);
      if (!itemId || !sourceId) {
        if (!droppedItemIdSet.has(link.platformItemId)) {
          droppedLinkItemIds.push(link.platformItemId);
        }
        continue;
      }
      const key = `${itemId}::${sourceId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      linkValues.push({ itemId, sourceId });
    }
    for (const batch of chunk(linkValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(itemSources).values(batch).onConflictDoNothing();
    }

    const inserted: IngestedItem[] = [];
    for (const pid of itemByPid.keys()) {
      if (preExisting.has(pid)) continue;
      const itemId = itemIdMap.get(pid);
      if (itemId) inserted.push({ platformItemId: pid, itemId });
    }

    // 4b. Text of the new content-bearing items, in the SAME tx as their rows:
    //     'has_content' ⇒ the text is stored (GHOSTS rule 2). A plain insert —
    //     a row inserted above cannot have a content row yet. Never a
    //     transcript, so `subtitle_source` is written as NULL with the text.
    //     Sharing the tx means a failure of THIS insert rolls back every row
    //     of the call, not just its own item — which is why step 3 stores
    //     `storableText`: a NUL byte, the one thing Postgres `text` refuses,
    //     never gets here.
    const contentValues = inserted.flatMap(({ platformItemId, itemId }) => {
      const plainText = storedText.get(platformItemId);
      return plainText === undefined ? [] : [{ itemId, plainText, subtitleSource: null }];
    });
    for (const batch of chunk(contentValues, CONTENT_INSERT_CHUNK_SIZE)) {
      await tx.insert(itemContents).values(batch);
    }

    return {
      inserted,
      droppedItemIds,
      droppedLinkItemIds,
      linkCount: linkValues.length,
      storedText,
    };
  });

  // 5. Chunks OUTSIDE the tx (each replaceItemChunks opens its own
  //    transaction; nesting deadlocks the single-connection proxy). Embedding
  //    deferred (D3). Targets: newly inserted content-bearing items, then the
  //    platform's ghost sweep (self-heal).
  const contentPersisted: string[] = [];
  const healedItemIds: string[] = [];
  if (input.content) {
    const { textOf, chunk: chunkText } = input.content;

    // 5a. Newly inserted items whose text step 4b stored: chunk it and settle
    //     the state. `item_contents` is not written again.
    const insertedPids = new Set<string>();
    for (const { platformItemId, itemId } of result.inserted) {
      insertedPids.add(platformItemId);
      const plainText = storedText.get(platformItemId);
      if (plainText === undefined) continue;
      if (await chunkAndSettle(db, itemId, plainText, chunkText)) {
        contentPersisted.push(platformItemId);
      }
    }

    // 5b. Ghost sweep: items claiming content ('chunked'/'has_content') with no
    //     chunk rows. Text source order: this run's textOf (written through
    //     `settleItemContent` — it may differ from, or be the first, stored
    //     text) → the persisted item_contents.plainText (re-chunked as is) →
    //     neither ⇒ honest 'no_content'. "This run's textOf" means what is
    //     left of it once normalised: a text of nothing but NULs is no text,
    //     and must not keep the ghost from its stored one.
    const ghosts = await db
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(and(eq(items.platform, platform), ghostItemCondition(db)));
    for (const ghost of ghosts) {
      if (insertedPids.has(ghost.platformItemId)) continue;
      const fresh = storableText(textOf(ghost.platformItemId));
      let written: boolean;
      if (fresh) {
        written = await settleItemContent(db, ghost.id, fresh, chunkText);
      } else {
        const rows = await db
          .select({ plainText: itemContents.plainText })
          .from(itemContents)
          .where(eq(itemContents.itemId, ghost.id))
          .limit(1);
        const stored = (rows[0]?.plainText ?? '').trim();
        written = await chunkAndSettle(db, ghost.id, stored, chunkText);
      }
      if (written) {
        contentPersisted.push(ghost.platformItemId);
        healedItemIds.push(ghost.platformItemId);
      }
    }
  }

  return { ...result, contentPersisted, healedItemIds };
}
