import { and, eq, exists, inArray, not, sql, type SQL } from 'drizzle-orm';

import type { FavbaseDb } from '@/lib/database';
import { itemChunks } from '@/lib/database/entities/item-chunks';
import { itemTags } from '@/lib/database/entities/item-tags';
import { items } from '@/lib/database/entities/items';

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

/** SQL facts shared by Collection processing readers and workers. */
export function createCollectionProcessingPolicy(
  db: FavbaseDb,
  platform?: string,
): CollectionProcessingPolicy {
  const scope = platform ? eq(items.platform, platform) : sql<boolean>`true`;
  const downstreamEligible = not(
    every(
      eq(items.platform, 'bilibili'),
      sql<boolean>`coalesce(${items.platformMeta}->>'attr', '') = '9'`,
    ),
  );
  const contentTotal = every(scope, downstreamEligible);
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
