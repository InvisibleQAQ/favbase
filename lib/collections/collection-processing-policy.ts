import { and, eq, exists, inArray, ne, not, or, sql, type SQL } from 'drizzle-orm';

import type { FavbaseDb } from '@/lib/database';
import { itemChunks } from '@/lib/database/entities/item-chunks';
import { itemTags } from '@/lib/database/entities/item-tags';
import { items } from '@/lib/database/entities/items';

import {
  PLATFORM_DOWNSTREAM_ELIGIBILITY,
  type PlatformDownstreamEligibility,
} from './platform-eligibility';
import { isCollectionPlatform } from './platforms';

export interface CollectionProcessingPolicy {
  scope: SQL;
  content: {
    total: SQL;
    done: SQL;
  };
  embedding: {
    total: SQL;
    done: SQL;
    pendingCandidate: SQL;
  };
  tagging: {
    total: SQL;
    done: SQL;
    pendingCandidate: SQL;
  };
}

function every(...conditions: SQL[]): SQL {
  const condition = and(...conditions);
  if (!condition) {
    throw new Error('Collection processing policy requires at least one condition');
  }
  return condition;
}

function either(...conditions: SQL[]): SQL {
  const condition = or(...conditions);
  if (!condition) {
    throw new Error('Collection processing policy requires at least one condition');
  }
  return condition;
}

const ALWAYS = sql<boolean>`true`;

/**
 * Downstream eligibility for the given scope. A scoped policy applies only
 * that platform's predicate (unknown discriminators stay eligible); an
 * unscoped one must hold every platform's rule at once, so each registered
 * predicate is widened to `platform <> X OR eligible(X)` before conjunction.
 */
function downstreamEligibleFor(
  platform: string | undefined,
  eligibility: PlatformDownstreamEligibility,
): SQL {
  if (platform) {
    return (isCollectionPlatform(platform) && eligibility[platform]) || ALWAYS;
  }
  const rules = Object.entries(eligibility).flatMap(([name, predicate]) =>
    predicate ? [either(ne(items.platform, name), predicate)] : [],
  );
  return rules.length ? every(...rules) : ALWAYS;
}

/**
 * SQL facts shared by Collection processing readers and workers. Platform
 * exclusions are injected from the exhaustive registry (default) so no
 * caller can forget them; tests pass a custom table to isolate the composition.
 */
export function createCollectionProcessingPolicy(
  db: FavbaseDb,
  platform?: string,
  eligibility: PlatformDownstreamEligibility = PLATFORM_DOWNSTREAM_ELIGIBILITY,
): CollectionProcessingPolicy {
  const scope = platform ? eq(items.platform, platform) : ALWAYS;
  const contentTotal = every(scope, downstreamEligibleFor(platform, eligibility));
  const embeddingTotal = every(
    contentTotal,
    inArray(items.contentState, ['chunked', 'embedded']),
  );
  const hasChunks = exists(
    db
      .select({ value: sql`1` })
      .from(itemChunks)
      .where(eq(itemChunks.itemId, items.id)),
  );
  const hasTag = exists(
    db
      .select({ value: sql`1` })
      .from(itemTags)
      .where(eq(itemTags.itemId, items.id)),
  );

  return {
    scope,
    content: {
      total: contentTotal,
      done: every(
        contentTotal,
        inArray(items.contentState, ['chunked', 'embedded', 'no_content', 'error']),
      ),
    },
    embedding: {
      total: embeddingTotal,
      done: every(embeddingTotal, eq(items.contentState, 'embedded')),
      pendingCandidate: every(
        contentTotal,
        eq(items.contentState, 'chunked'),
        hasChunks,
      ),
    },
    tagging: {
      total: embeddingTotal,
      done: every(embeddingTotal, hasTag),
      pendingCandidate: every(embeddingTotal, not(hasTag)),
    },
  };
}
