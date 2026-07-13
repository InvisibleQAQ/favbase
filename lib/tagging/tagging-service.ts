import { and, eq, inArray, sql, desc } from 'drizzle-orm';
import { getDb, type FavbaseDb } from '@/lib/database';
import { emitDomainEvent } from '@/lib/events';
import { items } from '@/lib/database/entities/items';
import { itemContents } from '@/lib/database/entities/item-contents';
import { tags } from '@/lib/database/entities/tags';
import { itemTags } from '@/lib/database/entities/item-tags';
import { getTaggingConfig, type ResolvedTaggingConfig } from './config';
import { generateTags } from './tagger';
import type { TaggingInput } from './prompt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagRef {
  id: string;
  name: string;
}

export interface UsedTag extends TagRef {
  count: number;
}

export interface TaggedItem {
  itemId: string;
  platform: string;
  platformItemId: string;
  title: string;
  authorName: string;
  /** items.originalUrl — lets platform card adapters link out without re-deriving URLs. */
  originalUrl: string;
  platformMeta: Record<string, unknown>;
  tags: TagRef[];
}

export type TagItemResult = 'tagged' | 'skipped' | 'failed';

/** Injectable seams for tests (mirrors IndexingDeps DI style). */
export interface TaggingDeps {
  db: () => FavbaseDb;
  getConfig: () => Promise<ResolvedTaggingConfig>;
  generate: (
    config: ResolvedTaggingConfig,
    input: TaggingInput,
    existingTags: string[],
  ) => Promise<string[]>;
}

const defaultDeps: TaggingDeps = {
  db: getDb,
  getConfig: getTaggingConfig,
  generate: generateTags,
};

// ---------------------------------------------------------------------------
// Pipeline entry — the single seam called after transcription persists
// ---------------------------------------------------------------------------

/**
 * AI-tag one item, addressed by (platform, platformItemId) so callers never
 * need the DB uuid. Never throws — designed for fire-and-forget use at the
 * end of the transcription pipeline.
 *
 * 'skipped': tagging not configured (no LLM apiKey), item missing, item
 * already tagged (idempotent — re-transcription won't re-tag), or the LLM
 * returned no tags. 'failed': LLM/DB error (logged, item stays untagged; no
 * retry, no keyword fallback by design).
 */
export async function tagPlatformItem(
  platform: string,
  platformItemId: string,
  deps?: Partial<TaggingDeps>,
): Promise<TagItemResult> {
  const d = { ...defaultDeps, ...deps };
  try {
    const config = await d.getConfig();
    if (!config.enabled) return 'skipped';

    const db = d.db();
    const itemRows = await db
      .select({
        id: items.id,
        title: items.title,
        authorName: items.authorName,
        platformMeta: items.platformMeta,
      })
      .from(items)
      .where(and(eq(items.platform, platform), eq(items.platformItemId, platformItemId)))
      .limit(1);
    if (itemRows.length === 0) return 'skipped';
    const item = itemRows[0];

    const linked = await db
      .select({ tagId: itemTags.tagId })
      .from(itemTags)
      .where(eq(itemTags.itemId, item.id))
      .limit(1);
    if (linked.length > 0) return 'skipped';

    const contentRows = await db
      .select({ plainText: itemContents.plainText })
      .from(itemContents)
      .where(eq(itemContents.itemId, item.id))
      .limit(1);

    // Existing tags stay library-wide (no platform filter): the LLM should
    // reuse tag names across platforms, not fork per-platform duplicates.
    const existing = await getAllUsedTags(undefined, db);
    const meta = item.platformMeta as Record<string, unknown>;
    const names = await d.generate(
      config,
      {
        title: item.title,
        author: item.authorName,
        description: typeof meta.intro === 'string' && meta.intro ? meta.intro : undefined,
        content: contentRows[0]?.plainText,
      },
      existing.map((tag) => tag.name),
    );
    if (names.length === 0) return 'skipped';

    await linkTagsToItem(db, item.id, names);
    emitDomainEvent('item-tagged', { platform, platformItemId });
    return 'tagged';
  } catch (err) {
    console.error('[tagging] Tagging failed for %s:%s:', platform, platformItemId, err);
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// UI reads
// ---------------------------------------------------------------------------

/**
 * All tags linked to at least one item, most-used first. Orphan tags (all
 * links removed) are invisible here by construction — no cleanup job needed.
 * Optional `platform` restricts both the tag list and the counts to that
 * platform's items (page-scoped filter chips); omit for the whole library.
 */
export async function getAllUsedTags(
  platform?: string,
  db: FavbaseDb = getDb(),
): Promise<UsedTag[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${itemTags.itemId})::int`,
    })
    .from(tags)
    .innerJoin(itemTags, eq(itemTags.tagId, tags.id))
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .where(platform ? eq(items.platform, platform) : undefined)
    .groupBy(tags.id, tags.name)
    .orderBy(sql`count(${itemTags.itemId}) desc`, tags.name);
  return rows;
}

/** Batch tag lookup for a page of cards: platformItemId → tags (name-sorted). */
export async function getTagsForPlatformItems(
  platform: string,
  platformItemIds: string[],
  db: FavbaseDb = getDb(),
): Promise<Record<string, TagRef[]>> {
  if (platformItemIds.length === 0) return {};
  const rows = await db
    .select({ platformItemId: items.platformItemId, id: tags.id, name: tags.name })
    .from(itemTags)
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(and(eq(items.platform, platform), inArray(items.platformItemId, platformItemIds)))
    .orderBy(tags.name);

  const result: Record<string, TagRef[]> = {};
  for (const row of rows) {
    (result[row.platformItemId] ??= []).push({ id: row.id, name: row.name });
  }
  return result;
}

/**
 * Items carrying ALL of the given tags (AND semantics — multi-select narrows),
 * newest first. Cross-folder by design: tags are a knowledge-base dimension,
 * not a folder dimension. Optional `platform` restricts results to that
 * platform's items (page-scoped tag grids); omit for cross-platform results.
 */
export async function getItemsByTags(
  tagIds: string[],
  platform?: string,
  db: FavbaseDb = getDb(),
): Promise<TaggedItem[]> {
  if (tagIds.length === 0) return [];

  const matched = await db
    .select({
      itemId: items.id,
      platform: items.platform,
      platformItemId: items.platformItemId,
      title: items.title,
      authorName: items.authorName,
      originalUrl: items.originalUrl,
      platformMeta: items.platformMeta,
    })
    .from(items)
    .innerJoin(itemTags, eq(itemTags.itemId, items.id))
    .where(
      and(
        inArray(itemTags.tagId, tagIds),
        platform ? eq(items.platform, platform) : undefined,
      ),
    )
    .groupBy(items.id)
    .having(sql`count(distinct ${itemTags.tagId}) = ${tagIds.length}`)
    .orderBy(desc(items.createdAt));
  if (matched.length === 0) return [];

  const tagRows = await db
    .select({ itemId: itemTags.itemId, id: tags.id, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(
      inArray(
        itemTags.itemId,
        matched.map((m) => m.itemId),
      ),
    )
    .orderBy(tags.name);

  const tagsByItem = new Map<string, TagRef[]>();
  for (const row of tagRows) {
    const list = tagsByItem.get(row.itemId) ?? [];
    list.push({ id: row.id, name: row.name });
    tagsByItem.set(row.itemId, list);
  }

  return matched.map((m) => ({
    ...m,
    platformMeta: m.platformMeta as Record<string, unknown>,
    tags: tagsByItem.get(m.itemId) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// UI writes (manual edit)
// ---------------------------------------------------------------------------

/** Manually attach a tag (created on first use) to an item. null = item not found / blank name. */
export async function addTagToPlatformItem(
  platform: string,
  platformItemId: string,
  name: string,
  db: FavbaseDb = getDb(),
): Promise<TagRef | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const itemId = await resolveItemId(db, platform, platformItemId);
  if (!itemId) return null;

  const refs = await linkTagsToItem(db, itemId, [trimmed]);
  return refs[0] ?? null;
}

/** Detach a tag from an item. The tag row survives; once orphaned it simply stops appearing in used-tag lists. */
export async function removeTagFromPlatformItem(
  platform: string,
  platformItemId: string,
  tagId: string,
  db: FavbaseDb = getDb(),
): Promise<void> {
  const itemId = await resolveItemId(db, platform, platformItemId);
  if (!itemId) return;
  await db.delete(itemTags).where(and(eq(itemTags.itemId, itemId), eq(itemTags.tagId, tagId)));
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function resolveItemId(
  db: FavbaseDb,
  platform: string,
  platformItemId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.platform, platform), eq(items.platformItemId, platformItemId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Upsert tag names + link to item, idempotent (both inserts conflict-ignore). */
async function linkTagsToItem(db: FavbaseDb, itemId: string, names: string[]): Promise<TagRef[]> {
  return db.transaction(async (tx) => {
    await tx
      .insert(tags)
      .values(names.map((name) => ({ name })))
      .onConflictDoNothing({ target: [tags.name] });

    const refs = await tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(inArray(tags.name, names));

    if (refs.length > 0) {
      await tx
        .insert(itemTags)
        .values(refs.map((ref) => ({ itemId, tagId: ref.id })))
        .onConflictDoNothing();
    }
    return refs;
  });
}
