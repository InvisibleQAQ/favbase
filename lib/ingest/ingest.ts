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
 * - `preExisting` diff: content is persisted for NEWLY inserted items only;
 * - two-phase content write: item_contents + chunks go OUTSIDE the tx
 *   (replaceItemChunks opens its own transaction — nesting on the
 *   single-connection proxy would deadlock). Embedding is deferred (D3) —
 *   app.html callers fire `embedNewItems` after the sync returns.
 *
 * Offscreen-safe: zero '@/lib/storage' reach. `replaceItemChunks` is a leaf
 * import (the '@/lib/embedding' barrel touches chrome.storage at module load,
 * which offscreen documents don't have — same rule as x-sync-service).
 */

import { eq, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import { chunk } from '@/lib/database/sql-utils';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items, type NewItem } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemContents } from '@/lib/database/entities/item-contents';
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
   * (newly inserted ∩ non-empty text) — the content-persisted seam callers
   * feed to auto-tagging (audit docs/16 MEDIUM-2). Empty when `content` is
   * absent from the input.
   */
  contentPersisted: string[];
  /** platformItemIds dropped because their author row could not be resolved. */
  droppedItemIds: string[];
  /** platformItemIds of links that failed to resolve (author drops excluded). */
  droppedLinkItemIds: string[];
  /** item_sources rows written this run (post-dedupe). */
  linkCount: number;
}

export async function ingestCollection(db: FavbaseDb, input: IngestInput): Promise<IngestResult> {
  const { platform } = input;

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

    const itemByPid = new Map<string, IngestItem>();
    for (const item of input.items) {
      if (!itemByPid.has(item.platformItemId)) itemByPid.set(item.platformItemId, item);
    }

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
        contentState: item.contentState,
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

  // 5. Content + chunks for NEW items only, OUTSIDE the tx (each
  //    replaceItemChunks opens its own transaction; nesting deadlocks the
  //    single-connection proxy). Embedding deferred (D3).
  const contentPersisted: string[] = [];
  if (input.content) {
    for (const { platformItemId, itemId } of result.inserted) {
      const plainText = input.content.textOf(platformItemId).trim();
      if (!plainText) continue;
      await db
        .insert(itemContents)
        .values({ itemId, plainText })
        .onConflictDoUpdate({
          target: itemContents.itemId,
          set: { plainText, updatedAt: new Date() },
        });
      await replaceItemChunks(db, itemId, input.content.chunk(plainText));
      contentPersisted.push(platformItemId);
    }
  }

  return { ...result, contentPersisted };
}
