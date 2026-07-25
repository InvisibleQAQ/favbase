import { and, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemTags } from '@/lib/database/entities/item-tags';

import type { CollectionPlatform } from './platforms';

const ALL_ITEMS = sql<boolean>`true`;
const DOWNSTREAM_ELIGIBILITY: Record<CollectionPlatform, SQL<boolean>> = {
  bilibili: sql<boolean>`coalesce(${items.platformMeta}->>'attr', '') <> '9'`,
  github: ALL_ITEMS,
  bookmarks: ALL_ITEMS,
  x: ALL_ITEMS,
  zhihu: ALL_ITEMS,
  youtube: ALL_ITEMS,
};

export interface ProcessingCoverageCount {
  done: number;
  /** `null` means the remote total is not durably knowable. */
  total: number | null;
}

export interface ProcessingCoverage {
  acquisition: ProcessingCoverageCount;
  content: ProcessingCoverageCount;
  embedding: ProcessingCoverageCount;
  tagging: ProcessingCoverageCount;
}

export const EMPTY_PROCESSING_COVERAGE: ProcessingCoverage = {
  acquisition: { done: 0, total: null },
  content: { done: 0, total: 0 },
  embedding: { done: 0, total: 0 },
  tagging: { done: 0, total: 0 },
};

/** Read-only, platform-scoped coverage snapshot for Collection page progress. */
export async function getProcessingCoverage(
  platform: CollectionPlatform,
  db: FavbaseDb = getDb(),
): Promise<ProcessingCoverage> {
  const downstreamEligible = DOWNSTREAM_ELIGIBILITY[platform];
  const settledContent = inArray(items.contentState, [
    'chunked',
    'embedded',
    'no_content',
    'error',
  ]);
  const embeddableContent = inArray(items.contentState, ['chunked', 'embedded']);
  const settledAndEligible = and(downstreamEligible, settledContent);
  const embeddableAndEligible = and(downstreamEligible, embeddableContent);
  const hasTag = exists(
    db
      .select({ value: sql`1` })
      .from(itemTags)
      .where(eq(itemTags.itemId, items.id)),
  );
  const rows = await db
    .select({
      acquired: sql<number>`count(*)::int`,
      contentDone: sql<number>`(count(*) filter (where ${settledAndEligible}))::int`,
      contentTotal: sql<number>`(count(*) filter (where ${downstreamEligible}))::int`,
      embeddingDone: sql<number>`(
        count(*) filter (
          where ${downstreamEligible} and ${items.contentState} = 'embedded'
        )
      )::int`,
      embeddingTotal: sql<number>`(count(*) filter (where ${embeddableAndEligible}))::int`,
      taggingDone: sql<number>`(
        count(*) filter (
          where ${embeddableAndEligible} and ${hasTag}
        )
      )::int`,
    })
    .from(items)
    .where(eq(items.platform, platform));
  const row = rows[0];
  const acquired = Number(row?.acquired ?? 0);
  const embeddable = Number(row?.embeddingTotal ?? 0);

  return {
    acquisition: { done: acquired, total: null },
    content: {
      done: Number(row?.contentDone ?? 0),
      total: Number(row?.contentTotal ?? 0),
    },
    embedding: { done: Number(row?.embeddingDone ?? 0), total: embeddable },
    tagging: { done: Number(row?.taggingDone ?? 0), total: embeddable },
  };
}
