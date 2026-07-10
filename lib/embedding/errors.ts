/**
 * HNSW index hard cap for `vector` columns (pgvector 0.8.1: "column cannot
 * have more than 2000 dimensions for hnsw index"). Vectors wider than this
 * cannot be ANN-indexed, so the store rejects them before any DDL or write.
 */
export const MAX_INDEXABLE_DIMENSIONS = 2000;

/**
 * Common embedding dimensions / Matryoshka truncation targets across major
 * providers (OpenAI v3, Gemini, ZhiPu, BGE-M3, Qwen3, nomic...), filtered to
 * values <= MAX_INDEXABLE_DIMENSIONS. Single source for the settings-page
 * dimensions Select. Research: task 07-10 restrict-embedding-dimensions.
 */
export const COMMON_EMBEDDING_DIMENSIONS = [256, 512, 768, 1024, 1536] as const;

/**
 * Thrown when a vector's length does not match the expected dimension —
 * either the current `item_chunks.embedding` column width (search path) or
 * the batch's leading vector (a mixed-dimension batch is a caller bug).
 * `expected` is always explicit; there is no canonical dimension anymore —
 * the column follows the active embedding model.
 */
export class EmbeddingDimensionError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(actual: number, expected: number) {
    super(`Embedding dimension mismatch: expected ${expected}, got ${actual}.`);
    this.name = 'EmbeddingDimensionError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Thrown when a requested embedding dimension cannot back the HNSW index
 * (outside 1..MAX_INDEXABLE_DIMENSIONS). Silent degradation to an unindexed
 * column is forbidden — the user should switch to a smaller-dimension model
 * or configure dimension truncation (e.g. OpenAI's `dimensions` option).
 */
export class EmbeddingDimensionLimitError extends Error {
  readonly actual: number;
  readonly limit = MAX_INDEXABLE_DIMENSIONS;

  constructor(actual: number) {
    super(
      `Embedding dimension ${actual} is outside the indexable range ` +
        `1..${MAX_INDEXABLE_DIMENSIONS} (pgvector HNSW cap). Switch to a ` +
        `smaller-dimension model or configure dimension truncation.`,
    );
    this.name = 'EmbeddingDimensionLimitError';
    this.actual = actual;
  }
}
