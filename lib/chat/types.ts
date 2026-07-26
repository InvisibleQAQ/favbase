import type { CollectionPlatform } from '@/lib/collections/platforms';

/**
 * Shared chat-retrieval types. Kept in one place so later phases (tools.ts,
 * source-card) import a single contract. Read-only: nothing here implies a write.
 */

/** A fused id + its RRF score. Output of `reciprocalRankFusion`. */
export interface FusedHit {
  id: string;
  score: number;
}

/** Options for `reciprocalRankFusion`. */
export interface RrfOptions {
  /** Rank-fusion constant (higher = flatter). Default 60. */
  k?: number;
  /** Truncate the fused output to the top-N. Default: no truncation. */
  topK?: number;
}

/** The collected item a retrieved chunk belongs to (source-card payload in P4). */
export interface RetrievalItem {
  /** Internal DB uuid (opaque; flows to the tool output as `item_id`). */
  id: string;
  title: string;
  /**
   * Original URL on the source platform. Source cards open this directly — there
   * is no per-item internal detail route to link to (see sections/chat/source-card).
   */
  url: string;
  platform: string;
}

/** One hybrid-retrieval result: a chunk, its RRF score, and its owning item. */
export interface RetrievalHit {
  chunkId: string;
  chunkText: string;
  /** Fused RRF score (rank-based; not a cosine/similarity value). */
  score: number;
  item: RetrievalItem;
}

/** Public options for `hybridRetrieve`. */
export interface HybridRetrieveOptions {
  /** Max fused results to return. Default 8. */
  topK?: number;
  /** Minimum cosine score for the semantic arm (score = 1 - distance). */
  minScore?: number;
  /** Restrict to one or more collection platforms (applied in SQL). */
  platform?: CollectionPlatform | CollectionPlatform[];
  /** Restrict to items carrying this tag id (applied in SQL via EXISTS). */
  tagId?: string;
}

/**
 * Injectable dependency for the semantic arm — kept out of the public options so
 * the retrieval test can run network-free. `embedQuery` returns the query vector
 * embedded with the CURRENT embedding model (so its width matches the
 * `item_chunks.embedding` column), or `null` when embedding is not configured.
 */
export interface RetrievalDeps {
  embedQuery(query: string): Promise<number[] | null>;
}
