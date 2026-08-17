import { sql } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';

import type { CollectionPlatform } from './platforms';
import { createCollectionProcessingPolicy } from './collection-processing-policy';

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
  const policy = createCollectionProcessingPolicy(db, platform);
  const rows = await db
    .select({
      acquired: sql<number>`count(*)::int`,
      contentDone: sql<number>`(count(*) filter (where ${policy.content.done}))::int`,
      contentTotal: sql<number>`(count(*) filter (where ${policy.content.total}))::int`,
      embeddingDone: sql<number>`(count(*) filter (where ${policy.embedding.done}))::int`,
      embeddingTotal: sql<number>`(count(*) filter (where ${policy.embedding.total}))::int`,
      taggingDone: sql<number>`(count(*) filter (where ${policy.tagging.done}))::int`,
    })
    .from(items)
    .where(policy.scope);
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
