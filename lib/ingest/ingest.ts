/**
 * Shared collection-ingest pipeline — single owner of the five-stage
 * insert-only transaction skeleton that every platform sync-service used to
 * copy (audit docs/16 HIGH-1). Platforms declare normalized rows (+ their
 * content chunker); this module holds the schema knowledge and invariants:
 *
 * - transaction boundary: one insert-only tx for sources/authors/items/links;
 * - `sources` upsert is the ADR-allowed exception (title / platformMeta /
 *   lastFetchedAt freshness — renames flow through), and runs even when items
 *   are empty so the UI can distinguish "never synced" from "synced, empty";
 * - authors / items / item_sources are insert-only (`onConflictDoNothing`,
 *   first-write-wins — ADR in .trellis/spec/frontend/database-bridge.md);
 * - batched INSERTs (`chunk(500)` keeps bind-params < PG 65535);
 * - id maps re-selected by platform (covers rows that existed before this
 *   run — a known item newly added to another source still gets its link);
 * - `preExisting` diff: content is persisted for NEWLY inserted items — plus
 *   the platform's GHOST items (see below), which self-heal on every sync;
 * - two-phase content write: item_contents + chunks go OUTSIDE the tx
 *   (replaceItemChunks opens its own transaction — nesting on the
 *   single-connection proxy would deadlock). Embedding is deferred (D3) —
 *   app.html callers dispatch the shared embed lane after the sync returns.
 *
 * GHOSTS. An interrupted phase-5 run (page close, dev reload, mid-run error)
 * used to leave items that CLAIMED 'chunked' with zero chunk rows — invisible
 * to both the embed batch (skipped silently) and the settings rebuild (its
 * EXISTS(chunks) filter). Two rules eliminate them:
 *   1. 'chunked' is only ever written AFTER chunk rows are persisted. Items
 *      declared 'chunked' by the platform are INSERTED as 'has_content' and
 *      flipped per item in phase 5 (mirrors saveBookmarkContent's safe order).
 *   2. When `content` is provided, phase 5 also sweeps the platform's ghosts
 *      (state IN ('chunked','has_content') with no chunk rows): re-chunk from
 *      `textOf` or the persisted `item_contents.plainText`; when neither text
 *      source exists, settle honestly at 'no_content'. Healed ids join
 *      `contentPersisted`, so they flow into the embed/tag lanes like new ones.
 *
 * Offscreen-safe: zero '@/lib/storage' reach. `replaceItemChunks` is a leaf
 * import (the '@/lib/embedding' barrel touches chrome.storage at module load,
 * which offscreen documents don't have — same rule as x-sync-service).
 */

import { and, eq, exists, inArray, not, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { chunk } from '@/lib/database/sql-utils';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items, type NewItem } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemContents } from '@/lib/database/entities/item-contents';
import { itemChunks } from '@/lib/database/entities/item-chunks';
import { replaceItemChunks } from '@/lib/embedding/vector-store';
import type { ChunkInput } from '@/lib/embedding/types';

/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;

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
  /** Raw text of a newly inserted item; empty / whitespace-only → skipped. */
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
  /** Items newly inserted this run (content persisted for these only). */
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
 * Two-phase content write for ONE item: `item_contents` upsert + chunk
 * rebuild, both OUTSIDE any caller transaction (`replaceItemChunks` opens its
 * own — nesting on the single-connection proxy deadlocks). Empty /
 * whitespace-only text is skipped. Returns whether CHUNK ROWS were actually
 * written — `true` is the caller's license to claim 'chunked'; a chunker that
 * yields zero chunks returns `false` so no state can ever say 'chunked' over
 * an empty chunk set (the ghost-sweep convergence guarantee). Shared by the
 * ingest content step below and the bookmarks extraction pipeline
 * (`saveBookmarkContent` in lib/bookmarks/bookmarks-sync-service.ts).
 */
export async function persistItemContent(
  db: FavbaseDb,
  itemId: string,
  text: string,
  chunkText: (plainText: string) => ChunkInput[],
): Promise<boolean> {
  const plainText = text.trim();
  if (!plainText) return false;
  await db
    .insert(itemContents)
    .values({ itemId, plainText })
    .onConflictDoUpdate({
      target: itemContents.itemId,
      set: { plainText, updatedAt: new Date() },
    });
  const inserted = await replaceItemChunks(db, itemId, chunkText(plainText));
  return inserted.length > 0;
}

/**
 * Replace durable content for an item that already exists in the collection.
 * The caller addresses the item by platform identity and supplies prepared
 * chunks, so database UUID lookup and the `chunked` state transition stay
 * inside the ingest module. Content and `has_content` commit before chunk
 * replacement, so a replacement failure never leaves stale `embedded` state
 * over new text. Missing items and blank text are explicit no-ops.
 */
export async function persistExistingItemContent(
  db: FavbaseDb,
  platform: string,
  platformItemId: string,
  text: string,
  preparedChunks: ChunkInput[],
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
      .values({ itemId, plainText })
      .onConflictDoUpdate({
        target: itemContents.itemId,
        set: { plainText, updatedAt },
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

  // Deduped up front (first-seen wins) — phase 5 consults the DECLARED state
  // to know which inserted items carry content.
  const itemByPid = new Map<string, IngestItem>();
  for (const item of input.items) {
    if (!itemByPid.has(item.platformItemId)) itemByPid.set(item.platformItemId, item);
  }

  const result = await db.transaction(async (tx) => {
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
    const existingRows = await tx
      .select({ platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, platform));
    const preExisting = new Set(existingRows.map((r) => r.platformItemId));

    const droppedItemIds: string[] = [];
    const itemValues: NewItem[] = [];
    for (const item of itemByPid.values()) {
      const authorId = authorIdMap.get(item.platformAuthorId);
      if (!authorId) {
        droppedItemIds.push(item.platformItemId);
        continue;
      }
      itemValues.push({
        platform,
        platformItemId: item.platformItemId,
        authorId,
        title: item.title,
        authorName: item.authorName,
        originalUrl: item.originalUrl,
        publishedAt: item.publishedAt,
        // 'chunked' may only be claimed AFTER chunk rows land (phase 5, outside
        // this tx). Content-bearing items enter as 'has_content'; an interrupted
        // run leaves them there, where the next sync's ghost sweep picks them up.
        contentState: item.contentState === 'chunked' ? 'has_content' : item.contentState,
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

    return { inserted, droppedItemIds, droppedLinkItemIds, linkCount: linkValues.length };
  });

  // 5. Content + chunks OUTSIDE the tx (each replaceItemChunks opens its own
  //    transaction; nesting deadlocks the single-connection proxy). Embedding
  //    deferred (D3). Targets: newly inserted content-bearing items, then the
  //    platform's ghost sweep (self-heal).
  const contentPersisted: string[] = [];
  const healedItemIds: string[] = [];
  if (input.content) {
    const { textOf, chunk: chunkText } = input.content;

    const settleContent = async (
      itemId: string,
      platformItemId: string,
      text: string,
    ): Promise<boolean> => {
      const written = text.trim()
        ? await persistItemContent(db, itemId, text, chunkText)
        : false;
      await db
        .update(items)
        .set({ contentState: written ? 'chunked' : 'no_content', updatedAt: new Date() })
        .where(eq(items.id, itemId));
      if (written) contentPersisted.push(platformItemId);
      return written;
    };

    // 5a. Newly inserted items the platform declared content for.
    const insertedPids = new Set<string>();
    for (const { platformItemId, itemId } of result.inserted) {
      insertedPids.add(platformItemId);
      if (itemByPid.get(platformItemId)?.contentState !== 'chunked') continue;
      await settleContent(itemId, platformItemId, textOf(platformItemId));
    }

    // 5b. Ghost sweep: items claiming content ('chunked'/'has_content') with no
    //     chunk rows. Text source order: this run's textOf → the persisted
    //     item_contents.plainText → neither ⇒ honest 'no_content'.
    const ghosts = await db
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(and(eq(items.platform, platform), ghostItemCondition(db)));
    for (const ghost of ghosts) {
      if (insertedPids.has(ghost.platformItemId)) continue;
      let text = textOf(ghost.platformItemId);
      if (!text.trim()) {
        const rows = await db
          .select({ plainText: itemContents.plainText })
          .from(itemContents)
          .where(eq(itemContents.itemId, ghost.id))
          .limit(1);
        text = rows[0]?.plainText ?? '';
      }
      const written = await settleContent(ghost.id, ghost.platformItemId, text);
      if (written) healedItemIds.push(ghost.platformItemId);
    }
  }

  return { ...result, contentPersisted, healedItemIds };
}
