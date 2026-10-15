import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type FavbaseDb } from '@/lib/database';
import { emitDomainEvent } from '@/lib/events';
import type { CooperativeCheckpoint } from '@/lib/collections';
import { isCollectionPlatform, type CollectionPlatform } from '@/lib/collections/platforms';
// Leaf import, never the '@/lib/collections' barrel (docs/26 iron rule 4).
import { PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
import { createCollectionProcessingPolicy } from '@/lib/collections/collection-processing-policy';
import { items } from '@/lib/database/entities/items';
import { itemContents } from '@/lib/database/entities/item-contents';
import { tags } from '@/lib/database/entities/tags';
import { itemTags } from '@/lib/database/entities/item-tags';
import { getTaggingConfig, type ResolvedTaggingConfig } from './config';
import { generateTags, TaggingSpendError, type GeneratedTags } from './tagger';
import { storageTaggingBudget, type TaggingBudget } from './budget';
import type { TaggingInput } from './prompt';
import { getAllUsedTags, type UsedTag } from './tag-queries';

export { getAllUsedTags, type UsedTag } from './tag-queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagRef {
  id: string;
  name: string;
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

export type TagItemResult = 'tagged' | 'skipped' | 'failed' | 'deferred';

/** Injectable seams for tests (mirrors IndexingDeps DI style). */
export interface TaggingDeps {
  db: () => FavbaseDb;
  getConfig: () => Promise<ResolvedTaggingConfig>;
  generate: (
    config: ResolvedTaggingConfig,
    input: TaggingInput,
    existingTags: string[],
  ) => Promise<GeneratedTags>;
  /** The Tagging Budget (docs/41): checked before each LLM call, charged after it. */
  budget: TaggingBudget;
}

const defaultDeps: TaggingDeps = {
  db: getDb,
  getConfig: getTaggingConfig,
  generate: generateTags,
  budget: storageTaggingBudget,
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
 * retry, no keyword fallback by design). 'deferred': today's Tagging Budget
 * is spent or its ledger is unreadable — no LLM call, no DB write; the item
 * stays pending for a later run. Not a failure.
 *
 * This is the only place the budget is checked and charged (docs/41 §3): the
 * check runs only for an item that is about to cost a call, and every call
 * that came back is charged, whether or not it produced tags.
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
    // Past the candidate check this item will cost a call: check before reading
    // anything else, so a spent day does not run the library-wide tag query per item.
    if (!(await hasBudgetLeft(d.budget, platform, platformItemId))) return 'deferred';

    const contentRows = await db
      .select({ plainText: itemContents.plainText })
      .from(itemContents)
      .where(eq(itemContents.itemId, item.id))
      .limit(1);

    // Existing tags stay library-wide (no platform filter): the LLM should
    // reuse tag names across platforms, not fork per-platform duplicates.
    const existing = await getAllUsedTags(undefined, db);
    // Which meta key (if any) holds a description the Content does not already
    // carry is a platform fact — the descriptor names it, this module never
    // does (docs/32 Step 2).
    const field = isCollectionPlatform(platform)
      ? PLATFORM_DESCRIPTORS[platform].descriptionField
      : null;
    const description = field
      ? (item.platformMeta as Record<string, unknown>)[field]
      : undefined;
    const input: TaggingInput = {
      title: item.title,
      author: item.authorName,
      description: typeof description === 'string' && description ? description : undefined,
      content: contentRows[0]?.plainText,
    };
    const names = await generateAndCharge(d, config, input, existing.map((tag) => tag.name));
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
 * Serial tagging loop over a given id list — the body of `tagPlatformBacklog`,
 * which the app's Tags lane dispatches at every Platform Sync's end (docs/41
 * D7). Sequential on purpose — a first sync can insert hundreds of items, and
 * serial awaits are the pacing that keeps the LLM API from being hammered.
 * Inherits tagPlatformItem's never-throws / idempotent / unconfigured-silent-skip
 * semantics, so one bad item never aborts the rest.
 *
 * The first 'deferred' item ends the run: the Tagging Budget is shared by every
 * platform and only renews tomorrow (or when the cap is raised), so the rest
 * would defer too. The run still completes normally — it does not throw.
 *
 * `onProgress` (mirrors the embed lane) fires once with `{ done: 0, total }`
 * before the loop (total = `ids.length`, the input count — a 'skipped' or
 * 'failed' item still advances `done`, unlike embed's filtered total) then
 * again after each item settles. Monotonic; reaches `total` unless the run
 * ends early at a 'deferred' item, which does not advance it. Pure notifier —
 * never throws.
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
    if ((await tagPlatformItem(platform, platformItemId, deps)) === 'deferred') return;
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

/** Budget check before a call. An unreadable ledger counts as spent: no ledger, no spending. */
async function hasBudgetLeft(
  budget: TaggingBudget,
  platform: string,
  platformItemId: string,
): Promise<boolean> {
  try {
    return (await budget.remaining()) > 0;
  } catch (err) {
    console.error(
      '[tagging] Tagging Budget unreadable; deferring %s:%s:',
      platform,
      platformItemId,
      err,
    );
    return false;
  }
}

/**
 * One LLM call, charged as soon as it settles — before anything else can fail.
 * A failed call is charged what it is known to have cost, then rethrown.
 */
async function generateAndCharge(
  d: TaggingDeps,
  config: ResolvedTaggingConfig,
  input: TaggingInput,
  existingTags: string[],
): Promise<string[]> {
  let generated: GeneratedTags;
  try {
    generated = await d.generate(config, input, existingTags);
  } catch (err) {
    await chargeQuietly(d.budget, err instanceof TaggingSpendError ? err.tokens : 0);
    throw err;
  }
  await chargeQuietly(d.budget, generated.tokens);
  return generated.tags;
}

/** The money is already spent, so a failed charge only warns: it never turns a result into 'failed'. */
async function chargeQuietly(budget: TaggingBudget, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  try {
    await budget.charge(tokens);
  } catch (err) {
    console.warn('[tagging] Failed to charge %d tokens to the Tagging Budget:', tokens, err);
  }
}

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
