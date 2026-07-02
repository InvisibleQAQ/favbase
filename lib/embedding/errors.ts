import { EMBEDDING_DIMENSIONS } from '@/lib/ai';

/**
 * Thrown when a vector's length does not match the fixed `item_chunks.embedding`
 * column width (`EMBEDDING_DIMENSIONS`). pgvector's fixed-dimension column + ANN
 * index cannot hold off-dimension vectors, so upsert rejects them early.
 */
export class EmbeddingDimensionError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(actual: number, expected: number = EMBEDDING_DIMENSIONS) {
    super(
      `Embedding dimension mismatch: expected ${expected}, got ${actual}. ` +
        `The vector store column is fixed at VECTOR(${expected}).`,
    );
    this.name = 'EmbeddingDimensionError';
    this.expected = expected;
    this.actual = actual;
  }
}
