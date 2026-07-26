import type { FusedHit, RrfOptions } from './types';

/** Default rank-fusion constant (Azure/Elastic/Weaviate default). */
const DEFAULT_K = 60;

/**
 * Reciprocal Rank Fusion. Combines several independently-ranked id lists into a
 * single ranking using ONLY the ranks — never the raw scores — so lists scored
 * on different scales (cosine 0..1 vs. word_similarity 0..1) fuse robustly.
 *
 * `score(id) = Σ_lists 1 / (k + rank)`, `rank` 1-based. An id repeated within a
 * single list is counted once (first occurrence). Output is sorted by score
 * descending, ties broken by id ascending for deterministic results. Pure — no
 * IO, no side effects (unit-testable).
 */
export function reciprocalRankFusion(
  lists: string[][],
  options: RrfOptions = {},
): FusedHit[] {
  const k = options.k ?? DEFAULT_K;
  const scores = new Map<string, number>();

  for (const list of lists) {
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i];
      if (seen.has(id)) continue; // first occurrence wins within a list
      seen.add(id);
      const rank = i + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }

  const fused: FusedHit[] = [...scores.entries()].map(([id, score]) => ({ id, score }));
  fused.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return options.topK === undefined ? fused : fused.slice(0, options.topK);
}
