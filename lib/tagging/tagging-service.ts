import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type FavbaseDb } from '@/lib/database';
import { emitDomainEvent } from '@/lib/events';
import type { CooperativeCheckpoint } from '@/lib/collections';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { createCollectionProcessingPolicy } from '@/lib/collections/collection-processing-policy';
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
  /** items.publishedAt — preserved for platform cards that display the date. */
  publishedAt: Date | null;
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
    const policy = createCollectionProcessingPolicy(db, platform);
    const itemRows = await db
      .select({
        id: items.id,
        title: items.title,
        authorName: items.authorName,
        platformMeta: items.platformMeta,
      })
      .from(items)
      .where(and(eq(items.platformItemId, platformItemId), policy.tagging.pendingCandidate))
      .limit(1);
    if (itemRows.length === 0) return 'skipped';
    const item = itemRows[0];

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

/**
 * Batch entry for collection syncs (audit docs/16 MEDIUM-2): tag the items a
 * sync run just persisted content for, one at a time. Sequential on purpose —
 * a first sync can insert hundreds of items, and serial awaits are the pacing
 * that keeps the LLM API from being hammered. Inherits tagPlatformItem's
 * never-throws / idempotent / unconfigured-silent-skip semantics, so one bad
 * item never aborts the rest. Fire-and-forget from callers (`void tagNewItems(…)`).
 *
 * `onProgress` (mirrors the embed lane) fires once with `{ done: 0, total }`
 * before the loop (total = `ids.length`, the input count — a 'skipped' item
 * still advances `done`, unlike embed's filtered total) then again after each
 * item settles. Monotonic, always reaches 100%. Pure notifier — never throws.
 */
export async function tagNewItems(
  platform: string,
  platformItemIds: string[],
  deps?: Partial<TaggingDeps>,
  onProgress?: (progress: { done: number; total: number }) => void,
  control?: CooperativeCheckpoint,
): Promise<void> {
  const total = platformItemIds.length;
  let done = 0;
  onProgress?.({ done, total });
  for (const platformItemId of platformItemIds) {
    await control?.checkpoint();
    await tagPlatformItem(platform, platformItemId, deps);
    done += 1;
    onProgress?.({ done, total });
  }
}

/** Retry the unfinished AI-tagging work for one Collection platform. */
export async function tagPlatformBacklog(
  platform: CollectionPlatform,
  deps?: Partial<TaggingDeps>,
  onProgress?: (progress: { done: number; total: number }) => void,
  control?: CooperativeCheckpoint,
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const config = await d.getConfig();
  if (!config.enabled) {
    onProgress?.({ done: 0, total: 0 });
    return;
  }

  const db = d.db();
  const policy = createCollectionProcessingPolicy(db, platform);
  const candidates = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(policy.tagging.pendingCandidate)
    .orderBy(asc(items.createdAt), asc(items.id));

  await tagNewItems(
    platform,
    candidates.map((item) => item.platformItemId),
    { ...d, getConfig: async () => config },
    onProgress,
    control,
  );
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
  platform?: string | readonly string[],
  db: FavbaseDb = getDb(),
): Promise<UsedTag[]> {
  const platforms = typeof platform === 'string' ? [platform] : platform;
  const platformCondition = platforms
    ? platforms.length > 0
      ? inArray(items.platform, [...platforms])
      : sql<boolean>`false`
    : undefined;
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${itemTags.itemId})::int`,
    })
    .from(tags)
    .innerJoin(itemTags, eq(itemTags.tagId, tags.id))
    .innerJoin(items, eq(items.id, itemTags.itemId))
    .where(platformCondition)
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
      publishedAt: items.publishedAt,
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
