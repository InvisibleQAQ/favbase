import { sql } from 'drizzle-orm';

// Leaf imports, not the `@/lib/database` barrel: the barrel re-exports `./db`,
// which value-imports PGlite and the RPC handler. This module is reachable from
// the Background Service Worker through the `getProcessingCoverage` Knowledge
// Tool, and `scripts/check-background-bundle.mjs` fails the build if PGlite
// lands in that graph (same rule as `lib/tagging/tag-queries.ts`).
import { getDb } from '@/lib/database/db-state';
import type { FavbaseDb } from '@/lib/database/db-types';
import { items } from '@/lib/database/entities/items';

import { isCollectionPlatform, type CollectionPlatform } from './platforms';
import { mapPlatforms } from './platform-descriptor';
import {
  createCollectionProcessingPolicy,
  type CollectionProcessingPolicy,
} from './collection-processing-policy';

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

/** Raw counters one aggregate row carries, before stage assembly. */
interface CoverageRow {
  acquired: number;
  contentDone: number;
  contentTotal: number;
  embeddingDone: number;
  embeddingTotal: number;
  taggingDone: number;
}

/**
 * The six counters both readers select. Downstream eligibility lives **only**
 * inside these `filter` clauses, never in the statement's `WHERE`: `acquired`
 * counts every persisted row in scope, and an item excluded from the downstream
 * stages (an invalid Bilibili video, say) was still acquired. Hoisting the
 * eligibility predicate to `WHERE` would silently shrink the acquisition count.
 */
function coverageColumns(policy: CollectionProcessingPolicy) {
  return {
    acquired: sql<number>`count(*)::int`,
    contentDone: sql<number>`(count(*) filter (where ${policy.content.done}))::int`,
    contentTotal: sql<number>`(count(*) filter (where ${policy.content.total}))::int`,
    embeddingDone: sql<number>`(count(*) filter (where ${policy.embedding.done}))::int`,
    embeddingTotal: sql<number>`(count(*) filter (where ${policy.embedding.total}))::int`,
    taggingDone: sql<number>`(count(*) filter (where ${policy.tagging.done}))::int`,
  };
}

/**
 * Assembles one aggregate row into the four stages. A missing row (a platform
 * with nothing persisted) yields the same zero snapshot as an empty library, so
 * neither reader needs a special case for it.
 */
function toCoverage(row: CoverageRow | undefined): ProcessingCoverage {
  const embeddable = Number(row?.embeddingTotal ?? 0);
  return {
    acquisition: { done: Number(row?.acquired ?? 0), total: null },
    content: {
      done: Number(row?.contentDone ?? 0),
      total: Number(row?.contentTotal ?? 0),
    },
    embedding: { done: Number(row?.embeddingDone ?? 0), total: embeddable },
    tagging: { done: Number(row?.taggingDone ?? 0), total: embeddable },
  };
}

/** Read-only, platform-scoped coverage snapshot for Collection page progress. */
export async function getProcessingCoverage(
  platform: CollectionPlatform,
  db: FavbaseDb = getDb(),
): Promise<ProcessingCoverage> {
  const policy = createCollectionProcessingPolicy(db, platform);
  const rows = await db
    .select(coverageColumns(policy))
    .from(items)
    .where(policy.scope);
  return toCoverage(rows[0]);
}

/**
 * Read-only coverage for every Collection Platform in one grouped statement,
 * for callers that report the whole library at once (the `getProcessingCoverage`
 * Knowledge Tool). Six scoped reads would each scan the table and, where the DB
 * lives behind the Offscreen RPC proxy, cost six round trips.
 *
 * The unscoped policy widens each platform's eligibility rule to
 * `platform <> X OR eligible(X)`, which is exactly what grouping needs: the rule
 * collapses to `eligible` for that platform's own rows and to `true` for
 * everyone else's. Platforms with nothing persisted are absent from the result
 * set and filled in as zero snapshots, so the caller always sees every platform.
 */
export async function getAllProcessingCoverage(
  db: FavbaseDb = getDb(),
): Promise<Record<CollectionPlatform, ProcessingCoverage>> {
  const policy = createCollectionProcessingPolicy(db);
  const rows = await db
    .select({ platform: items.platform, ...coverageColumns(policy) })
    .from(items)
    .where(policy.scope)
    .groupBy(items.platform);

  const byPlatform: Partial<Record<CollectionPlatform, CoverageRow>> = {};
  for (const { platform, ...counts } of rows) {
    if (isCollectionPlatform(platform)) byPlatform[platform] = counts;
  }
  return mapPlatforms(byPlatform, toCoverage);
}
