import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import type { FavbaseDb } from '@/lib/database';
import * as schema from '@/lib/database/schema';
import { escapeLike } from '@/lib/database/sql-utils';
import { createEmbeddingModel, embedText } from '@/lib/ai';
import { semanticSearchChunks } from '@/lib/embedding/vector-store';
import { EmbeddingDimensionError } from '@/lib/embedding/errors';
import { reciprocalRankFusion } from './rrf';
import type {
  HybridRetrieveOptions,
  RetrievalDeps,
  RetrievalHit,
  RetrievalItem,
} from './types';

const { items, itemChunks, itemTags } = schema;

/** RRF fusion constant. */
const RRF_K = 60;
/** Default number of fused hits returned. */
const DEFAULT_TOP_K = 8;

/**
 * Default semantic-arm embedder: resolve the active embedding config and embed
 * the query with the SAME model that populated the column (so the vector width
 * matches). Returns `null` when embedding is not configured — the caller then
 * runs keyword-only. Composed from existing infra (`getEmbeddingSettings` +
 * `createEmbeddingModel` + `embedText`); no new client is introduced.
 */
const defaultEmbedQuery: RetrievalDeps['embedQuery'] = async (query) => {
  // Lazy import: keeps `@/lib/storage` (WXT eager getItem) out of the module
  // graph so consumers injecting `embedQuery` (tests) never load it.
  const { getEmbeddingSettings } = await import('@/lib/embedding/config');
  const config = await getEmbeddingSettings();
  if (!config.enabled) return null;
  const model = createEmbeddingModel({
    providerId: config.providerId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  });
  return embedText(model, query, {
    providerId: config.providerId,
    dimensions: config.dimensions,
  });
};

const defaultDeps: RetrievalDeps = { embedQuery: defaultEmbedQuery };

interface KeywordRow extends Record<string, unknown> {
  chunk_id: string;
  item_id: string;
  chunk_text: string;
}

/**
 * Keyword arm: trigram/ILIKE recall over `item_chunks.chunk_text`. ILIKE gives
 * exact-substring recall (GIN `gin_trgm_ops`-accelerated), `word_similarity`
 * ranks the filtered rows (better than plain `similarity()` for short-query /
 * long-chunk — see research/retrieval-design.md §1.2). Read-only.
 */
async function keywordArm(
  db: FavbaseDb,
  query: string,
  limit: number,
): Promise<KeywordRow[]> {
  const pattern = `%${escapeLike(query)}%`;
  const result = await db.execute<KeywordRow>(sql`
    SELECT id AS chunk_id, item_id, chunk_text
    FROM item_chunks
    WHERE chunk_text ILIKE ${pattern} ESCAPE '\\'
    ORDER BY word_similarity(${query}, chunk_text) DESC,
             length(chunk_text) ASC,
             id ASC
    LIMIT ${limit}
  `);
  return (result.rows ?? []) as KeywordRow[];
}

/**
 * Semantic arm: embed the query then cosine-ANN search. Returns `[]` (never
 * throws) when embedding is unconfigured or the query vector width no longer
 * matches the column (config drift) — chat degrades to keyword-only rather than
 * breaking. Any other error propagates (real bug).
 */
async function semanticArm(
  db: FavbaseDb,
  query: string,
  limit: number,
  minScore: number | undefined,
  embedQuery: RetrievalDeps['embedQuery'],
): Promise<{ chunkId: string; itemId: string; chunkText: string }[]> {
  const vector = await embedQuery(query);
  if (!vector) return [];

  try {
    const hits = await semanticSearchChunks(db, vector, { topK: limit, minScore });
    return hits.map((h) => ({ chunkId: h.chunkId, itemId: h.itemId, chunkText: h.chunkText }));
  } catch (err) {
    if (err instanceof EmbeddingDimensionError) {
      console.warn(
        '[chat] semantic arm skipped — query/column dimension mismatch (embedding config drift):',
        err.message,
      );
      return [];
    }
    throw err;
  }
}

interface ItemRow {
  id: string;
  title: string;
  url: string;
  platform: string;
}

/**
 * Load the filtered item metadata for the candidate chunks. Platform and tag
 * filters are applied HERE, in SQL, before RRF truncation — a strict filter
 * cannot be starved by the arms' global top-K. Read-only.
 */
async function loadItems(
  db: FavbaseDb,
  itemIds: string[],
  opts: HybridRetrieveOptions,
): Promise<Map<string, RetrievalItem>> {
  const conditions = [inArray(items.id, itemIds)];

  if (opts.platform) {
    const platformList = Array.isArray(opts.platform) ? opts.platform : [opts.platform];
    if (platformList.length > 0) conditions.push(inArray(items.platform, platformList));
  }

  if (opts.tagId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(itemTags)
          .where(and(eq(itemTags.itemId, items.id), eq(itemTags.tagId, opts.tagId))),
      ),
    );
  }

  const rows: ItemRow[] = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.originalUrl,
      platform: items.platform,
    })
    .from(items)
    .where(and(...conditions));

  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Hybrid retrieval over the local knowledge base: semantic (pgvector cosine) ∥
 * trigram/ILIKE keyword, fused with RRF, joined back to `items` for source
 * metadata. Fully read-only (SELECT / db.execute SELECT only).
 *
 * Degradation (never throws on the normal path): unconfigured embedding or a
 * query/column dimension mismatch drops the semantic arm and runs keyword-only;
 * a blank query or no candidates returns `[]`. See research/retrieval-design.md.
 */
export async function hybridRetrieve(
  db: FavbaseDb,
  query: string,
  options: HybridRetrieveOptions = {},
  deps: RetrievalDeps = defaultDeps,
): Promise<RetrievalHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const topK = options.topK ?? DEFAULT_TOP_K;
  const hasFilter = Boolean(options.platform || options.tagId);
  // Over-fetch per arm so RRF has material to fuse and a strict filter still has
  // survivors after the items join-back.
  const perArm = Math.min(hasFilter ? Math.max(topK * 5, 50) : Math.max(topK * 3, 30), 100);

  const [semanticHits, keywordHits] = await Promise.all([
    semanticArm(db, trimmed, perArm, options.minScore, deps.embedQuery),
    keywordArm(db, trimmed, perArm),
  ]);

  // chunkId -> { itemId, chunkText } from either arm (no extra chunk query).
  const chunkMap = new Map<string, { itemId: string; chunkText: string }>();
  for (const h of semanticHits) chunkMap.set(h.chunkId, { itemId: h.itemId, chunkText: h.chunkText });
  for (const r of keywordHits) {
    if (!chunkMap.has(r.chunk_id)) {
      chunkMap.set(r.chunk_id, { itemId: r.item_id, chunkText: r.chunk_text });
    }
  }
  if (chunkMap.size === 0) return [];

  const candidateItemIds = [...new Set([...chunkMap.values()].map((c) => c.itemId))];
  const itemMap = await loadItems(db, candidateItemIds, options);
  if (itemMap.size === 0) return [];

  // Keep only chunks whose item survived the platform/tag filter, preserving
  // each arm's rank order for RRF.
  const semanticRanked = semanticHits
    .filter((h) => itemMap.has(h.itemId))
    .map((h) => h.chunkId);
  const keywordRanked = keywordHits
    .filter((r) => itemMap.has(r.item_id))
    .map((r) => r.chunk_id);

  const fused = reciprocalRankFusion([semanticRanked, keywordRanked], { k: RRF_K, topK });

  const results: RetrievalHit[] = [];
  for (const { id: chunkId, score } of fused) {
    const chunk = chunkMap.get(chunkId);
    if (!chunk) continue;
    const item = itemMap.get(chunk.itemId);
    if (!item) continue;
    results.push({ chunkId, chunkText: chunk.chunkText, score, item });
  }
  return results;
}
